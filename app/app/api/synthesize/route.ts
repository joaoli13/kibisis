import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { dataSource, getPassages, isDatabaseConfigurationError } from "@/lib/db";
import {
  countCodePoints,
  jsonByteLength,
  SYNTHESIS_BODY_MAX_BYTES,
  SYNTHESIS_PASSAGE_LIMIT,
  validateFreeText,
  validateId,
  validateSearchFilters,
  type ValidationFailure
} from "@/lib/input-limits";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";
import { buildSynthesisContext, buildSynthesisPrompt, isQuestion } from "@/lib/synthesis";
import type { SynthesisLocale } from "@/lib/synthesis";
import type { SearchFilters } from "@/lib/types";

type SynthesizeBody = {
  query?: unknown;
  retrievalQuery?: unknown;
  question?: unknown;
  passageIds?: unknown;
  filters?: unknown;
  locale?: unknown;
};

type GenerativeModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
type GenerateContentResult = Awaited<ReturnType<GenerativeModel["generateContent"]>>;

const filterKeys: Array<keyof SearchFilters> = ["author", "work", "genre", "period", "language", "textType"];
const locales = new Set<SynthesisLocale>(["en", "pt", "es"]);

function filtersAreValid(value: unknown): value is SearchFilters | undefined {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return filterKeys.every((key) => {
    const fieldValue = (value as Record<string, unknown>)[key];
    return (
      fieldValue === undefined ||
      typeof fieldValue === "string" ||
      (Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string"))
    );
  });
}

function localeIsValid(value: unknown): value is SynthesisLocale | undefined {
  return value === undefined || (typeof value === "string" && locales.has(value as SynthesisLocale));
}

function bodyIsValid(body: SynthesizeBody): body is {
  query: string;
  retrievalQuery?: string;
  question?: string;
  passageIds: string[];
  filters?: SearchFilters;
  locale?: SynthesisLocale;
} {
  return (
    typeof body.query === "string" &&
    (body.retrievalQuery === undefined || typeof body.retrievalQuery === "string") &&
    (body.question === undefined || typeof body.question === "string") &&
    Array.isArray(body.passageIds) &&
    body.passageIds.every((id) => typeof id === "string") &&
    filtersAreValid(body.filters) &&
    localeIsValid(body.locale)
  );
}

function validationResponse(error: ValidationFailure) {
  return NextResponse.json(error, { status: error.status });
}

function maxOutputTokens(): number {
  const value = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 8192);
  if (!Number.isFinite(value)) {
    return 8192;
  }
  return Math.min(Math.max(Math.floor(value), 4096), 8192);
}

function thinkingBudget(): number {
  const value = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.floor(value), 0), 24576);
}

function finishReason(result: GenerateContentResult): string | undefined {
  return result.response.candidates?.[0]?.finishReason;
}

function isLikelyTruncated(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return true;
  }
  return !/[.!?…\])}"']$/.test(trimmed);
}

function providerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown provider error";
}

async function generateContentWithRetry(
  model: GenerativeModel,
  prompt: string,
  metadata: { modelName: string; operation: string }
): Promise<GenerateContentResult> {
  try {
    return await model.generateContent(prompt);
  } catch (error) {
    console.warn(JSON.stringify({
      route: "/api/synthesize",
      provider: "gemini",
      model: metadata.modelName,
      operation: metadata.operation,
      retry: "generation_error",
      error: providerErrorMessage(error)
    }));
    return model.generateContent(prompt);
  }
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  let statusCode = 200;
  let errorCode: string | undefined;
  let inputLength = 0;
  let requestBytes: number | undefined;
  const limited = rateLimit(request, "synthesize");
  if (limited) {
    statusCode = 429;
    errorCode = "rate_limited";
    logRequest({ request, route: "/api/synthesize", statusCode, latencyMs: Date.now() - started, errorCode, dataSource: dataSource() });
    return limited;
  }
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > SYNTHESIS_BODY_MAX_BYTES) {
      statusCode = 413;
      errorCode = "request_too_large";
      return validationResponse({
        error: "request_too_large",
        status: 413,
        field: "body",
        count: contentLength,
        limit: SYNTHESIS_BODY_MAX_BYTES
      });
    }
    const rawBody = await request.text();
    requestBytes = jsonByteLength(rawBody);
    if (requestBytes > SYNTHESIS_BODY_MAX_BYTES) {
      statusCode = 413;
      errorCode = "request_too_large";
      return validationResponse({
        error: "request_too_large",
        status: 413,
        field: "body",
        count: requestBytes,
        limit: SYNTHESIS_BODY_MAX_BYTES
      });
    }
    let body: SynthesizeBody;
    try {
      body = JSON.parse(rawBody) as SynthesizeBody;
    } catch {
      statusCode = 400;
      errorCode = "invalid_json";
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!bodyIsValid(body)) {
      statusCode = 400;
      errorCode = "invalid_body";
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    const effectiveQuestion = body.question?.trim() || body.query.trim();
    const retrievalQuery = body.retrievalQuery?.trim() || (body.question?.trim() ? body.query.trim() : "");
    inputLength = Math.max(countCodePoints(body.query), countCodePoints(body.question ?? ""), countCodePoints(body.retrievalQuery ?? ""));
    const textValidationError =
      validateFreeText(body.query, "query") ??
      validateFreeText(body.question ?? "", "question") ??
      validateFreeText(body.retrievalQuery ?? "", "retrievalQuery") ??
      validateSearchFilters(body.filters ?? {});
    if (textValidationError) {
      statusCode = textValidationError.status;
      errorCode = textValidationError.error;
      return validationResponse(textValidationError);
    }
    if (body.passageIds.length < 1) {
      statusCode = 400;
      errorCode = "empty_context";
      return NextResponse.json({ error: "empty_context" }, { status: 400 });
    }
    if (body.passageIds.length > SYNTHESIS_PASSAGE_LIMIT) {
      statusCode = 400;
      errorCode = "too_many_passages";
      return NextResponse.json(
        { error: "too_many_passages", field: "passageIds", count: body.passageIds.length, limit: SYNTHESIS_PASSAGE_LIMIT },
        { status: 400 }
      );
    }
    for (const id of body.passageIds) {
      const idValidationError = validateId(id, "passageIds");
      if (idValidationError) {
        statusCode = idValidationError.status;
        errorCode = idValidationError.error;
        return validationResponse(idValidationError);
      }
    }
    const passages = await getPassages(body.passageIds);
    if (passages.length < 1) {
      statusCode = 400;
      errorCode = "no_passages_found";
      return NextResponse.json({ error: "no_passages_found" }, { status: 400 });
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        withProvenance({
          markdown:
            "Gemini is not configured. The selected passages are available as cited sources.",
          sources: passages.map((passage, index) => ({ n: index + 1, passage }))
        }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    }
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const modelName = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const model = client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens: maxOutputTokens(),
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: thinkingBudget() }
      } as never
    });
    const context = buildSynthesisContext(passages);
    const queryMode = isQuestion(effectiveQuestion) ? "question" : "topic";
    try {
      let result = await generateContentWithRetry(
        model,
        buildSynthesisPrompt(effectiveQuestion, queryMode, context, false, body.filters, body.locale, retrievalQuery),
        { modelName, operation: "generate_answer" }
      );
      let markdown = result.response.text();
      let reason = finishReason(result);
      if (reason === "MAX_TOKENS" || isLikelyTruncated(markdown)) {
        console.warn(JSON.stringify({
          route: "/api/synthesize",
          provider: "gemini",
          model: modelName,
          operation: "retry_truncated_answer",
          finish_reason: reason ?? "unknown",
          output_chars: markdown.length
        }));
        result = await generateContentWithRetry(
          model,
          buildSynthesisPrompt(effectiveQuestion, queryMode, context, true, body.filters, body.locale, retrievalQuery),
          { modelName, operation: "generate_concise_answer" }
        );
        markdown = result.response.text();
        reason = finishReason(result);
      }
      if (reason === "MAX_TOKENS" || isLikelyTruncated(markdown)) {
        throw new Error(`gemini_truncated_answer:${reason ?? "unknown"}`);
      }
      return NextResponse.json(
        withProvenance({
          markdown,
          effectiveQuestion,
          sources: passages.map((passage, index) => ({ n: index + 1, passage }))
        }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    } catch (providerError) {
      const message = providerErrorMessage(providerError);
      console.error(JSON.stringify({
        route: "/api/synthesize",
        provider: "gemini",
        model: modelName,
        error: message
      }));
      return NextResponse.json(
        withProvenance({
          markdown:
            "Não foi possível gerar a resposta pelo LLM neste momento. As fontes selecionadas continuam listadas abaixo; tente novamente em instantes ou verifique a configuração da GEMINI_API_KEY/GEMINI_MODEL.",
          sources: passages.map((passage, index) => ({ n: index + 1, passage })),
          provider_error: "gemini_generation_failed"
        }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    }
  } catch (error) {
    statusCode = isDatabaseConfigurationError(error) ? 503 : 500;
    errorCode = isDatabaseConfigurationError(error) ? "database_not_configured" : "answer_failed";
    return NextResponse.json(
      { error: isDatabaseConfigurationError(error) ? "database_not_configured" : "answer_failed" },
      { status: statusCode }
    );
  } finally {
    logRequest({
      request,
      route: "/api/synthesize",
      statusCode,
      latencyMs: Date.now() - started,
      inputLength,
      requestBytes,
      errorCode,
      dataSource: dataSource()
    });
  }
}
