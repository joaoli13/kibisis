"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { valuesForFilter } from "@/lib/filters";
import { countCodePoints, FREE_TEXT_MAX_CODE_POINTS } from "@/lib/input-limits";
import { useAtlasStore } from "@/stores/atlas";
import type { Passage, SearchFilters } from "@/lib/types";

type Source = {
  n: number;
  passage: Passage;
};

type AnswerResponse = {
  markdown?: string;
  sources?: Source[];
  error?: string;
};

const CONTEXT_LIMIT = 7;

const filterValueMessageKeys: Partial<Record<keyof SearchFilters, Record<string, string>>> = {
  genre: {
    biography: "values.genre.biography",
    comedy: "values.genre.comedy",
    epic: "values.genre.epic",
    geography: "values.genre.geography",
    history: "values.genre.history",
    medicine: "values.genre.medicine",
    miscellany: "values.genre.miscellany",
    philosophy: "values.genre.philosophy",
    poetry: "values.genre.poetry",
    religion: "values.genre.religion",
    rhetoric: "values.genre.rhetoric",
    satire: "values.genre.satire",
    tragedy: "values.genre.tragedy"
  },
  period: {
    archaic: "values.period.archaic",
    classical: "values.period.classical",
    hellenistic: "values.period.hellenistic",
    roman: "values.period.roman"
  },
  language: {
    en: "values.language.en",
    eng: "values.language.eng",
    fre: "values.language.fre",
    grc: "values.language.grc",
    ita: "values.language.ita",
    la: "values.language.la",
    lat: "values.language.lat",
    unknown: "values.language.unknown"
  },
  textType: {
    original: "values.textType.original",
    translation: "values.textType.translation"
  }
};

const filterOrder: Array<keyof SearchFilters> = ["genre", "author", "work", "period", "language", "textType"];

function metadataLine(passage: Passage, partLabel: string): string {
  return [
    passage.author ?? passage.author_id ?? "Unknown author",
    passage.work ?? passage.work_id ?? "Unknown work",
    `${partLabel} ${passage.passage_ref}`
  ].join(" · ");
}

function passageTitle(passage: Passage, workFallback: string): string {
  return `${passage.work ?? passage.work_id ?? workFallback} ${passage.passage_ref}`;
}

function passageSnippet(passage: Passage, maxWords = 24): string {
  const words = passage.text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const snippet = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? `${snippet}...` : snippet;
}

function contextJson(query: string, passages: Passage[]): string {
  return JSON.stringify(
    {
      query,
      passage_count: passages.length,
      passages: passages.map((passage, index) => ({
        n: index + 1,
        id: passage.id,
        cts_urn: passage.cts_urn,
        author: passage.author ?? passage.author_id ?? null,
        work: passage.work ?? passage.work_id ?? null,
        passage_ref: passage.passage_ref,
        genre: passage.genre ?? null,
        period: passage.period ?? null,
        language: passage.language ?? null,
        text_type: passage.text_type ?? null,
        license_status: passage.license_status,
        source_url: passage.source_url ?? null,
        text: passage.text
      }))
    },
    null,
    2
  );
}

function SourceList({ sources, framed = true }: { sources: Source[]; framed?: boolean }) {
  const t = useTranslations("resultsPanel");
  if (!sources.length) {
    return null;
  }
  return (
    <div className={framed ? "mt-4 border-t border-[var(--line)] pt-3" : ""}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("sourcesUsed")}</h3>
      <ol className="space-y-2 text-xs text-neutral-700">
        {sources.map(({ n, passage }) => (
          <li className="space-y-1" key={passage.id}>
            <div>
              [{n}] {passageTitle(passage, t("workFallback"))}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{metadataLine(passage, t("part"))}</div>
            <div className="break-all text-[11px] text-neutral-500">{passage.cts_urn}</div>
            {passage.source_url ? (
              <a className="ml-1 text-[var(--accent)] underline" href={passage.source_url}>
                {t("source")}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CitationText({
  className,
  markdown,
  onCitation,
  sources
}: {
  className?: string;
  markdown: string;
  onCitation: (source: Source) => void;
  sources: Source[];
}) {
  const parts = markdown.split(/(\[\d+\])/g);
  return (
    <div className={className}>
      {parts.map((part, index) => {
        const citation = /^\[(\d+)\]$/.exec(part);
        if (!citation) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        const source = sources.find(({ n }) => n === Number(citation[1]));
        if (!source) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        return (
          <button
            className="mx-0.5 rounded border border-[var(--line)] px-1 text-[var(--accent)] hover:border-[var(--accent)]"
            key={`${part}-${index}`}
            onClick={() => onCitation(source)}
            type="button"
          >
            {part}
          </button>
        );
      })}
    </div>
  );
}

type ResultsPanelProps = {
  variant?: "panel" | "answer";
};

export function ResultsPanel({ variant = "panel" }: ResultsPanelProps) {
  const t = useTranslations("resultsPanel");
  const filtersT = useTranslations("filters");
  const locale = useLocale();
  const query = useAtlasStore((state) => state.activeQuery);
  const filters = useAtlasStore((state) => state.filters);
  const markdown = useAtlasStore((state) => state.answerMarkdown);
  const answerQuestion = useAtlasStore((state) => state.answerQuestion);
  const sources = useAtlasStore((state) => state.answerSources);
  const answerError = useAtlasStore((state) => state.answerError);
  const results = useAtlasStore((state) => state.results);
  const metadataSummary = useAtlasStore((state) => state.metadataSummary);
  const metadataTotalSummary = useAtlasStore((state) => state.metadataTotalSummary);
  const selectedPassageId = useAtlasStore((state) => state.selectedPassageId);
  const setAnswerError = useAtlasStore((state) => state.setAnswerError);
  const setAnswerMarkdown = useAtlasStore((state) => state.setAnswerMarkdown);
  const setAnswerQuestion = useAtlasStore((state) => state.setAnswerQuestion);
  const setAnswerSources = useAtlasStore((state) => state.setAnswerSources);
  const selectPassage = useAtlasStore((state) => state.selectPassage);
  const setWorkspaceMode = useAtlasStore((state) => state.setWorkspaceMode);
  const selectedFromResults = useMemo(
    () => results.find((passage) => passage.id === selectedPassageId) ?? null,
    [results, selectedPassageId]
  );
  const [fetchedSelected, setFetchedSelected] = useState<Passage | null>(null);
  const [selectedBusy, setSelectedBusy] = useState(false);
  const [selectedError, setSelectedError] = useState(false);
  const [contextPassageIds, setContextPassageIds] = useState<Set<string>>(() => new Set());
  const [contextStatus, setContextStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const previousResultsRef = useRef(results);
  const selected = selectedFromResults ?? fetchedSelected;
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const contextPassages = useMemo(
    () => results.filter((passage) => contextPassageIds.has(passage.id)).slice(0, CONTEXT_LIMIT),
    [results, contextPassageIds]
  );
  const passageLabel = t("passages");
  const contextLabel = t("inContext");
  const effectiveAnswerQuestion = answerQuestion.trim() || query;
  const answerQuestionLength = countCodePoints(effectiveAnswerQuestion.trim());
  const answerQuestionTooLong = answerQuestionLength > FREE_TEXT_MAX_CODE_POINTS;
  const canGenerateAnswer = !busy && contextPassages.length > 0 && !answerQuestionTooLong;
  const corpusScopeStats = useMemo(() => {
    if (!metadataTotalSummary) {
      return "";
    }
    const activeSearch = query.trim().length > 0;
    const visibleSummary = activeSearch
      ? {
          authors_count: new Set(results.map((result) => result.author_id ?? result.author).filter(Boolean)).size,
          works_count: new Set(results.map((result) => result.work_id ?? result.work).filter(Boolean)).size,
          passages_count: results.length
        }
      : metadataSummary;
    if (!visibleSummary) {
      return "";
    }
    return [
      `${numberFormatter.format(visibleSummary.authors_count)}/${numberFormatter.format(metadataTotalSummary.authors_count)} ${t("authors")}`,
      `${numberFormatter.format(visibleSummary.works_count)}/${numberFormatter.format(metadataTotalSummary.works_count)} ${t("works")}`,
      `${numberFormatter.format(visibleSummary.passages_count)}/${numberFormatter.format(metadataTotalSummary.passages_count)} ${t("passages")}`
    ].join(" · ");
  }, [metadataSummary, metadataTotalSummary, numberFormatter, query, results, t]);
  const corpusScopeStatsText = corpusScopeStats
    ? query.trim()
      ? t("retrievedStats", { stats: corpusScopeStats })
      : t("filteredStats", { stats: corpusScopeStats })
    : "";
  const answerScopeSummary = useMemo(() => {
    const parts: string[] = [];
    if (query.trim()) {
      parts.push(`${filtersT("searchQuery")}: ${query.trim()}`);
    }
    filterOrder.forEach((key) => {
      const value = filters[key];
      const values = valuesForFilter(value);
      if (!values.length) {
        return;
      }
      const label = filtersT(`fields.${key}`);
      if (key === "author") {
        const labels = values.map((item) => results.find((result) => result.author_id === item)?.author ?? item);
        parts.push(`${label}: ${labels.join(" OR ")}`);
        return;
      }
      if (key === "work") {
        const labels = values.map((item) => results.find((result) => result.work_id === item)?.work ?? item);
        parts.push(`${label}: ${labels.join(" OR ")}`);
        return;
      }
      const labels = values.map((item) => {
        const messageKey = filterValueMessageKeys[key]?.[item.toLowerCase()];
        return messageKey ? filtersT(messageKey) : item;
      });
      parts.push(`${label}: ${labels.join(" OR ")}`);
    });
    return parts.join(" · ");
  }, [filters, filtersT, query, results]);

  useEffect(() => {
    const resultsChanged = previousResultsRef.current !== results;
    previousResultsRef.current = results;
    setContextPassageIds(new Set(results.slice(0, CONTEXT_LIMIT).map((passage) => passage.id)));
    if (resultsChanged) {
      setAnswerMarkdown("");
      setAnswerSources([]);
      setAnswerError("");
      setWorkspaceMode("explore");
    }
    setExpanded(false);
    setDetailExpanded(false);
    setFetchedSelected(null);
    setSelectedBusy(false);
    setSelectedError(false);
  }, [results, setAnswerError, setAnswerMarkdown, setAnswerSources, setWorkspaceMode]);

  useEffect(() => {
    if (!contextStatus) {
      return;
    }
    const timeout = window.setTimeout(() => setContextStatus(""), 1800);
    return () => window.clearTimeout(timeout);
  }, [contextStatus]);

  useEffect(() => {
    function openPassageDetail(event: Event) {
      const detail = (event as CustomEvent<{ passageId?: string }>).detail;
      if (detail?.passageId) {
        selectPassage(detail.passageId);
        setDetailExpanded(true);
      }
    }

    window.addEventListener("kibisis:open-passage-detail", openPassageDetail);
    return () => window.removeEventListener("kibisis:open-passage-detail", openPassageDetail);
  }, [selectPassage]);

  useEffect(() => {
    if (!detailExpanded || !selectedPassageId) {
      setFetchedSelected(null);
      setSelectedBusy(false);
      setSelectedError(false);
      return;
    }

    if (selectedFromResults) {
      setFetchedSelected(null);
      setSelectedBusy(false);
      setSelectedError(false);
      return;
    }

    let cancelled = false;
    setSelectedBusy(true);
    setSelectedError(false);
    setFetchedSelected(null);
    fetch(`/api/passage/${encodeURIComponent(selectedPassageId)}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("passage_not_found");
        }
        return response.json() as Promise<{ passage?: Passage }>;
      })
      .then((payload) => {
        if (!cancelled) {
          if (!payload.passage) {
            throw new Error("passage_not_found");
          }
          setFetchedSelected(payload.passage);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedSelected(null);
          setSelectedError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailExpanded, selectedFromResults, selectedPassageId]);

  async function generateAnswer() {
    if (!canGenerateAnswer) {
      if (answerQuestionTooLong) {
        setAnswerError(t("tooLongError"));
      }
      return;
    }
    setBusy(true);
    setAnswerError("");
    const effectiveQuestion = effectiveAnswerQuestion.trim();
    try {
      const response = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          retrievalQuery: query,
          question: effectiveQuestion,
          filters,
          locale,
          passageIds: contextPassages.map((result) => result.id)
        })
      });
      const payload = (await response.json()) as AnswerResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "answer_failed");
      }
      setAnswerMarkdown(payload.markdown ?? "");
      setAnswerSources(payload.sources ?? []);
      setWorkspaceMode("answer");
    } catch (error) {
      setAnswerMarkdown("");
      setAnswerSources([]);
      const errorCode = error instanceof Error ? error.message : "";
      setAnswerError(
        errorCode === "input_too_long"
          ? t("tooLongError")
          : errorCode === "request_too_large"
            ? t("requestTooLargeError")
            : errorCode === "rate_limited"
              ? t("rateLimitedError")
              : errorCode === "invalid_body" || errorCode === "invalid_json" || errorCode === "invalid_id" || errorCode === "too_many_passages"
                ? t("invalidRequestError")
                : t("answerError")
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyContextJson() {
    const payload = contextJson(query, contextPassages);
    try {
      await navigator.clipboard.writeText(payload);
      setContextStatus(t("copySuccess"));
    } catch (error) {
      setContextStatus(t("copyError"));
    }
  }

  function downloadContextJson() {
    const blob = new Blob([contextJson(query, contextPassages)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kibisis-context.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setContextStatus(t("downloadStarted"));
  }

  function clearAnswer() {
    setAnswerMarkdown("");
    setAnswerSources([]);
    setAnswerError("");
    setExpanded(false);
    setWorkspaceMode("explore");
  }

  function toggleContextPassage(id: string) {
    const next = new Set(contextPassageIds);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < CONTEXT_LIMIT) {
      next.add(id);
    } else {
      return;
    }
    setContextPassageIds(next);
    clearAnswer();
  }

  function inspectPassage(id: string) {
    selectPassage(id);
    setDetailExpanded(true);
  }

  function inspectSource(source: Source) {
    selectPassage(source.passage.id);
    setDetailExpanded(true);
    window.dispatchEvent(
      new CustomEvent("kibisis:show-map-passage", { detail: { passage: source.passage, passageId: source.passage.id } })
    );
  }

  function showPassageOnMap(passage: Passage) {
    selectPassage(passage.id);
    window.dispatchEvent(new CustomEvent("kibisis:show-map-passage", { detail: { passage, passageId: passage.id } }));
  }

  if (variant === "answer") {
    return (
      <section className="min-h-0 overflow-visible bg-white lg:h-full lg:overflow-auto">
        <div className="border-b border-[var(--line)] bg-[var(--surface-muted)] p-5">
          <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{t("answerWorkspace")}</div>
              <h2 className="mt-1 text-xl font-semibold">{t("generatedResponse")}</h2>
              {answerScopeSummary ? <p className="mt-2 text-xs leading-5 text-neutral-500">{answerScopeSummary}</p> : null}
            </div>
            <button
              className="shrink-0 border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:border-[var(--accent)]"
              onClick={() => setWorkspaceMode("explore")}
              type="button"
            >
              {t("backToMap")}
            </button>
          </div>
        </div>

        <div className="grid min-h-0 gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <article className="min-w-0">
            {markdown ? (
              <CitationText
                className="whitespace-pre-wrap text-base leading-8 text-neutral-900"
                markdown={markdown}
                onCitation={inspectSource}
                sources={sources}
              />
            ) : answerError ? (
              <div className="text-sm leading-6 text-red-700">{answerError}</div>
            ) : (
              <div className="border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-5 text-sm text-neutral-600">
                {t("noAnswerYet")}
              </div>
            )}
          </article>

          <aside className="space-y-4">
            <section className="border border-[var(--line)] bg-[var(--surface-muted)] p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("context")}</div>
              <div className="mt-1 text-sm text-neutral-600">
                {results.length} {passageLabel} · {contextPassages.length} {contextLabel}
              </div>
              <label className="mt-3 block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-700">
                  {t("answerQuestion")}
                </span>
                <textarea
                  className="min-h-24 w-full border border-[var(--line)] bg-white px-3 py-2 text-sm leading-5"
                  aria-invalid={answerQuestionTooLong}
                  onChange={(event) => setAnswerQuestion(event.target.value)}
                  placeholder={t("answerQuestionPlaceholder")}
                  title={t("answerQuestionTooltip")}
                  value={answerQuestion}
                />
              </label>
              <div className={`mt-1 text-xs ${answerQuestionTooLong ? "text-red-700" : "text-neutral-500"}`}>
                {answerQuestionTooLong
                  ? t("questionLimitExceeded", { count: answerQuestionLength, limit: FREE_TEXT_MAX_CODE_POINTS })
                  : t("questionLimitCounter", { count: answerQuestionLength, limit: FREE_TEXT_MAX_CODE_POINTS })}
              </div>
              {query.trim() ? (
                <button
                  className="mt-2 text-xs font-semibold text-[var(--accent)] hover:underline"
                  onClick={() => setAnswerQuestion(query)}
                  type="button"
                >
                  {t("useSearchAsQuestion")}
                </button>
              ) : null}
              <div className="mt-3 grid gap-2">
                <button
                  className="border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  disabled={contextPassages.length < 1}
                  onClick={copyContextJson}
                  type="button"
                >
                  {t("copyContextJson")}
                </button>
                <button
                  className="border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                  disabled={contextPassages.length < 1}
                  onClick={downloadContextJson}
                  type="button"
                >
                  {t("downloadContextJson")}
                </button>
                <button
                  className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={!canGenerateAnswer}
                  onClick={generateAnswer}
                  type="button"
                >
                  {busy ? t("generatingAnswer") : t("generateAnswer")}
                </button>
              </div>
              {contextStatus ? <div className="mt-2 text-xs text-neutral-500">{contextStatus}</div> : null}
            </section>
            <SourceList framed={false} sources={sources} />
            <div className="space-y-1 text-xs leading-5 text-neutral-500">
              <p>{t("notice")}</p>
              {corpusScopeStatsText ? <p>{corpusScopeStatsText}</p> : null}
            </div>
          </aside>
        </div>

        {detailExpanded ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-6">
            <div className="max-h-[86vh] w-full max-w-3xl overflow-auto rounded border border-[var(--line)] bg-white p-4 shadow-xl sm:p-5">
              {selected ? (
                <>
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        {metadataLine(selected, t("part"))}
                      </div>
                      <h2 className="mt-1 text-lg font-semibold">{passageTitle(selected, t("workFallback"))}</h2>
                      <div className="mt-2 break-all text-xs text-neutral-500">{selected.cts_urn}</div>
                    </div>
                    <button
                      className="shrink-0 border border-[var(--line)] px-3 py-1 text-sm"
                      onClick={() => setDetailExpanded(false)}
                      type="button"
                    >
                      {t("close")}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-7">{selected.text}</p>
                  {selected.source_url ? (
                    <a className="mt-4 inline-block text-sm text-[var(--accent)] underline" href={selected.source_url}>
                      {t("source")}
                    </a>
                  ) : null}
                </>
              ) : (
                <div className="text-sm text-neutral-600">
                  {selectedBusy ? t("loadingPassage") : selectedError ? t("loadPassageError") : t("noPassageSelected")}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <aside className="overflow-visible border-t border-[var(--line)] bg-white lg:h-full lg:overflow-auto lg:border-l lg:border-t-0">
      <section className="border-b border-[var(--line)] p-4">
        <div className="mb-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">{t("results")}</h2>
              <div className="text-xs text-neutral-500">
                {results.length} {passageLabel} · {contextPassages.length} {contextLabel}
              </div>
            </div>
            {contextStatus ? <div className="text-xs text-neutral-500">{contextStatus}</div> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              className="border border-[var(--line)] px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
              disabled={contextPassages.length < 1}
              onClick={copyContextJson}
              type="button"
            >
              {t("copyContextJson")}
            </button>
            <button
              className="border border-[var(--line)] px-3 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-50"
              disabled={contextPassages.length < 1}
              onClick={downloadContextJson}
              type="button"
            >
              {t("downloadContextJson")}
            </button>
            <button
              className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!canGenerateAnswer}
              onClick={generateAnswer}
              type="button"
            >
              {busy ? t("generatingAnswer") : t("generateAnswer")}
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-700">
              {t("answerQuestion")}
            </span>
            <textarea
              className="min-h-20 w-full border border-[var(--line)] px-3 py-2 text-sm leading-5"
              aria-invalid={answerQuestionTooLong}
              onChange={(event) => setAnswerQuestion(event.target.value)}
              placeholder={t("answerQuestionPlaceholder")}
              title={t("answerQuestionTooltip")}
              value={answerQuestion}
            />
          </label>
          <div className={`text-xs ${answerQuestionTooLong ? "text-red-700" : "text-neutral-500"}`}>
            {answerQuestionTooLong
              ? t("questionLimitExceeded", { count: answerQuestionLength, limit: FREE_TEXT_MAX_CODE_POINTS })
              : t("questionLimitCounter", { count: answerQuestionLength, limit: FREE_TEXT_MAX_CODE_POINTS })}
          </div>
          {query.trim() ? (
            <button
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
              onClick={() => setAnswerQuestion(query)}
              type="button"
            >
              {t("useSearchAsQuestion")}
            </button>
          ) : null}
        </div>

        {markdown || answerError ? (
          <section className="mb-3 border border-[var(--line)] bg-[var(--surface-muted)] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700">
                {t("responseFromRetrieved")}
              </h2>
              {markdown ? (
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                    onClick={() => setWorkspaceMode("answer")}
                    type="button"
                  >
                    {t("readAnswer")}
                  </button>
                  <button
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                    onClick={() => setExpanded(true)}
                    type="button"
                  >
                    {t("openFullscreen")}
                  </button>
                </div>
              ) : null}
            </div>
            {markdown ? (
              <>
                <CitationText
                  className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6"
                  markdown={markdown}
                  onCitation={inspectSource}
                  sources={sources}
                />
                <SourceList sources={sources} />
              </>
            ) : (
              <div className="text-sm leading-6 text-red-700">{answerError}</div>
            )}
          </section>
        ) : null}

        <div className="space-y-2 overflow-visible lg:max-h-[31rem] lg:overflow-auto">
          {results.map((result, index) => {
            const inContext = contextPassageIds.has(result.id);
            const canInclude = inContext || contextPassages.length < CONTEXT_LIMIT;
            return (
            <article
              className={`border border-[var(--line)] p-3 transition ${inContext ? "bg-white" : "bg-neutral-50"}`}
              key={result.id}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <button
                  className="min-w-0 text-left hover:text-[var(--accent)]"
                  onClick={() => showPassageOnMap(result)}
                  type="button"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{metadataLine(result, t("part"))}</div>
                  <div className="mt-1 text-sm font-semibold">[{index + 1}] {passageTitle(result, t("workFallback"))}</div>
                </button>
                <button
                  aria-pressed={inContext}
                  className={`shrink-0 border px-2 py-1 text-xs disabled:opacity-50 ${
                    inContext ? "border-[var(--line)] text-neutral-700" : "border-[var(--accent)] text-[var(--accent)]"
                  }`}
                  disabled={!canInclude}
                  onClick={() => toggleContextPassage(result.id)}
                  type="button"
                >
                  {inContext ? t("exclude") : canInclude ? t("include") : t("limit", { count: CONTEXT_LIMIT })}
                </button>
              </div>
              <p className="text-xs leading-5 text-neutral-600">{passageSnippet(result)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <button
                  className="font-semibold text-[var(--accent)] hover:underline"
                  onClick={() => inspectPassage(result.id)}
                  type="button"
                >
                  {t("viewPassage")}
                </button>
                {result.source_url ? (
                  <a className="text-[var(--accent)] underline" href={result.source_url}>
                    {t("source")}
                  </a>
                ) : null}
              </div>
            </article>
            );
          })}
          {!results.length ? <div className="text-sm text-neutral-500">{t("noResults")}</div> : null}
        </div>
      </section>

      <div className="space-y-1 p-4 text-xs leading-5 text-neutral-500">
        <p>{t("notice")}</p>
        {corpusScopeStatsText ? <p>{corpusScopeStatsText}</p> : null}
      </div>

      {expanded ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-6">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded border border-[var(--line)] bg-white p-4 shadow-xl sm:p-5">
            <div className="mb-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{t("generatedResponse")}</h2>
                {answerScopeSummary ? (
                  <p className="mt-1 text-xs leading-5 text-neutral-500">{answerScopeSummary}</p>
                ) : null}
              </div>
              <button className="border border-[var(--line)] px-3 py-1 text-sm" onClick={() => setExpanded(false)} type="button">
                {t("close")}
              </button>
            </div>
            <div className="grid gap-5 lg:grid-cols-3">
              <section className="lg:col-span-2">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("response")}</h3>
                <CitationText
                  className="response-columns whitespace-pre-wrap text-sm leading-7"
                  markdown={markdown}
                  onCitation={inspectSource}
                  sources={sources}
                />
              </section>
              <section className="lg:col-span-1">
                <SourceList framed={false} sources={sources} />
              </section>
            </div>
            <style jsx>{`
              .response-columns {
                column-count: 2;
                column-gap: 2rem;
                orphans: 3;
                widows: 3;
              }

              @media (max-width: 1023px) {
                .response-columns {
                  column-count: 1;
                }
              }
            `}</style>
          </div>
        </div>
      ) : null}

      {detailExpanded ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-6">
          <div className="max-h-[86vh] w-full max-w-3xl overflow-auto rounded border border-[var(--line)] bg-white p-4 shadow-xl sm:p-5">
            {selected ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{metadataLine(selected, t("part"))}</div>
                    <h2 className="mt-1 text-lg font-semibold">{passageTitle(selected, t("workFallback"))}</h2>
                    <dl className="mt-3 grid gap-x-3 gap-y-1 text-xs text-neutral-600 sm:grid-cols-[104px_minmax(0,1fr)]">
                      <dt className="font-semibold uppercase tracking-wide">{t("metadata.author")}</dt>
                      <dd>{selected.author ?? selected.author_id ?? "N/A"}</dd>
                      <dt className="font-semibold uppercase tracking-wide">{t("metadata.work")}</dt>
                      <dd>{selected.work ?? selected.work_id ?? "N/A"}</dd>
                      {selected.work_date ? (
                        <>
                          <dt className="font-semibold uppercase tracking-wide">{t("metadata.workDate")}</dt>
                          <dd>{selected.work_date}</dd>
                        </>
                      ) : null}
                      <dt className="font-semibold uppercase tracking-wide">{t("metadata.reference")}</dt>
                      <dd>{selected.passage_ref}</dd>
                      <dt className="font-semibold uppercase tracking-wide">CTS URN</dt>
                      <dd className="break-all">{selected.cts_urn}</dd>
                      <dt className="font-semibold uppercase tracking-wide">{t("metadata.language")}</dt>
                      <dd>{selected.language ?? "N/A"}</dd>
                      <dt className="font-semibold uppercase tracking-wide">{t("metadata.license")}</dt>
                      <dd>{selected.license_status}</dd>
                    </dl>
                  </div>
                  <button
                    className="shrink-0 border border-[var(--line)] px-3 py-1 text-sm"
                    onClick={() => setDetailExpanded(false)}
                    type="button"
                  >
                    {t("close")}
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-7">{selected.text}</p>
                {selected.source_url ? (
                  <a className="mt-4 inline-block text-sm text-[var(--accent)] underline" href={selected.source_url}>
                    {t("source")}
                  </a>
                ) : null}
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-neutral-600">
                  {selectedBusy ? t("loadingPassage") : selectedError ? t("loadPassageError") : t("noPassageSelected")}
                </div>
                <button
                  className="shrink-0 border border-[var(--line)] px-3 py-1 text-sm"
                  onClick={() => setDetailExpanded(false)}
                  type="button"
                >
                  {t("close")}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
