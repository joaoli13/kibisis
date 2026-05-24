import type { Passage, SearchFilters } from "./types";
import { valuesForFilter } from "./filters";

export type QueryMode = "question" | "topic";
export type SynthesisLocale = "en" | "pt" | "es";

const localeNames: Record<SynthesisLocale, string> = {
  en: "English",
  pt: "Portuguese",
  es: "Spanish"
};

export function isQuestion(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    normalized.endsWith("?") ||
    /^(who|what|where|when|why|how|which|does|do|did|is|are|can|could|should)\b/.test(normalized) ||
    /^(quem|o que|que|qual|quais|onde|quando|como|por que|porque)\b/.test(normalized) ||
    /^(quien|quién|que|qué|cual|cuál|cuales|cuáles|donde|dónde|cuando|cuándo|como|cómo|por que|por qué)\b/.test(normalized)
  );
}

export function buildSynthesisContext(passages: Passage[]): string {
  return passages
    .map((passage, index) => {
      const metadata = [
        `Author: ${passage.author ?? passage.author_id ?? "unknown"}`,
        `Work: ${passage.work ?? passage.work_id ?? "unknown"}`,
        `Reference: ${passage.passage_ref}`,
        `CTS URN: ${passage.cts_urn}`,
        `Genre: ${passage.genre ?? "unknown"}`,
        `Period: ${passage.period ?? "unknown"}`,
        `Language: ${passage.language ?? "unknown"}`,
        `Text type: ${passage.text_type ?? "unknown"}`
      ].join(" | ");
      return `[${index + 1}] ${metadata}\n${passage.text}`;
    })
    .join("\n\n");
}

const filterLabels: Array<[keyof SearchFilters, string]> = [
  ["genre", "Genre"],
  ["author", "Author"],
  ["work", "Work"],
  ["period", "Period"],
  ["language", "Language"],
  ["textType", "Text type"]
];

export function describeSynthesisFilters(filters?: SearchFilters): string {
  if (!filters) {
    return "";
  }
  return filterLabels
    .flatMap(([key, label]) => {
      const values = valuesForFilter(filters[key]);
      return values.length ? [`${label}: ${values.join(" OR ")}`] : [];
    })
    .join(" | ");
}

export function buildSynthesisPrompt(
  query: string,
  queryMode: QueryMode,
  context: string,
  retry = false,
  filters?: SearchFilters,
  locale?: SynthesisLocale,
  retrievalQuery = ""
): string {
  const filterDescription = describeSynthesisFilters(filters);
  const localeInstruction = locale
    ? `The current interface language is ${localeNames[locale]} (${locale}). If the query is a proper name, a single term, empty, terse, or otherwise ambiguous for language detection, answer in ${localeNames[locale]}.`
    : "If the query is a proper name, a single term, empty, terse, or otherwise ambiguous for language detection, use the user's filter arguments as language hints when they indicate a language.";
  return [
    "Use only the cited passages below. Do not add facts that are not supported by those passages.",
    "Use inline bracket citations like [1] for every substantive claim.",
    "Answer in the same language as the user's query when that language is detectable. If the query is in Portuguese, answer in Portuguese; if it is in English, answer in English; if it is in Spanish, answer in Spanish.",
    localeInstruction,
    "Treat user filter arguments as language and scope hints only; do not treat them as evidence unless the supplied passages support the claim.",
    retry
      ? "The previous answer was cut off. Write exactly 5 compact paragraphs and finish cleanly."
      : "Write a concise but complete response with 5 to 8 paragraphs.",
    "Each paragraph should be focused and should normally contain 2 to 4 sentences.",
    "Do not use bullet points unless the user explicitly asks for a list.",
    "Complete the final sentence. Do not stop mid-sentence.",
    "The interface will list the cited sources separately after the response; do not add a separate bibliography.",
    queryMode === "question"
      ? "The user wrote a question. Try to answer it directly from the cited passages."
      : "The user wrote a topic or expression. Describe how that topic appears in the cited passages.",
    retrievalQuery
      ? "The retrieval query was used to find passages. Treat it as context about how the evidence was selected, but answer the explicit question below."
      : "No separate retrieval query was supplied.",
    "Before drafting, infer the likely scope and evidence type requested by the query: literary representation, historical evidence, philosophical argument, rhetorical use, religious or normative discourse, motif, language, reception, or cross-genre comparison.",
    "Use the passage metadata, especially Genre, Period, Language, and Text type, to decide which passages are compatible with that scope.",
    "If the selected passages span different genres or evidence types, separate them explicitly instead of blending them into one undifferentiated claim.",
    "Do not present literary, poetic, dramatic, mythical, or fictional passages as evidence for historical fact unless the user explicitly asks about representation, reception, motif, language, or cross-genre comparison.",
    "Use out-of-scope genres only as explicitly marked comparison, or state briefly that the retrieved context is heterogeneous or insufficient for the requested claim.",
    `Answer question: ${query}`,
    `Retrieval query: ${retrievalQuery || "none"}`,
    `Interface language: ${locale ? `${localeNames[locale]} (${locale})` : "unknown"}`,
    `User filter arguments: ${filterDescription || "none"}`,
    context
  ].join("\n\n");
}
