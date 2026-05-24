import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { dataSource, getPassages, isDatabaseConfigurationError } from "@/lib/db";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";
import { buildSynthesisContext, buildSynthesisPrompt, isQuestion } from "@/lib/synthesis";
import type { SynthesisLocale } from "@/lib/synthesis";
import type { SearchFilters } from "@/lib/types";

type SynthesizeBody = {
  query?: unknown;
  passageIds?: unknown;
  filters?: unknown;
  locale?: unknown;
};

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
    return fieldValue === undefined || typeof fieldValue === "string";
  });
}

function localeIsValid(value: unknown): value is SynthesisLocale | undefined {
  return value === undefined || (typeof value === "string" && locales.has(value as SynthesisLocale));
}

function bodyIsValid(body: SynthesizeBody): body is { query: string; passageIds: string[]; filters?: SearchFilters; locale?: SynthesisLocale } {
  return (
    typeof body.query === "string" &&
    Array.isArray(body.passageIds) &&
    body.passageIds.every((id) => typeof id === "string") &&
    filtersAreValid(body.filters) &&
    localeIsValid(body.locale)
  );
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

function finishReason(result: Awaited<ReturnType<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>>): string | undefined {
  return result.response.candidates?.[0]?.finishReason;
}

function isLikelyTruncated(markdown: string): boolean {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return true;
  }
  return !/[.!?…\])}"']$/.test(trimmed);
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "synthesize");
  if (limited) {
    return limited;
  }
  const started = Date.now();
  let statusCode = 200;
  try {
    const body = (await request.json()) as SynthesizeBody;
    if (!bodyIsValid(body)) {
      statusCode = 400;
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }
    if (body.passageIds.length < 1) {
      statusCode = 400;
      return NextResponse.json({ error: "empty_context" }, { status: 400 });
    }
    const passages = await getPassages(body.passageIds.slice(0, 7));
    if (passages.length < 1) {
      statusCode = 400;
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
    const queryMode = isQuestion(body.query) ? "question" : "topic";
    try {
      let result = await model.generateContent(buildSynthesisPrompt(body.query, queryMode, context, false, body.filters, body.locale));
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
        result = await model.generateContent(buildSynthesisPrompt(body.query, queryMode, context, true, body.filters, body.locale));
        markdown = result.response.text();
        reason = finishReason(result);
      }
      if (reason === "MAX_TOKENS" || isLikelyTruncated(markdown)) {
        throw new Error(`gemini_truncated_answer:${reason ?? "unknown"}`);
      }
      return NextResponse.json(
        withProvenance({
          markdown,
          sources: passages.map((passage, index) => ({ n: index + 1, passage }))
        }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : "unknown provider error";
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
      dataSource: dataSource()
    });
  }
}
