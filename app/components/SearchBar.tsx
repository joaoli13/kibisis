"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAtlasStore } from "@/stores/atlas";
import { appendFiltersToParams } from "@/lib/filters";
import { countCodePoints, FREE_TEXT_MAX_CODE_POINTS } from "@/lib/input-limits";
import { hasPassageNodeScope, hasTextSearch, shouldAutoOpenPassageMap } from "@/lib/search-behavior";
import type { SearchResult, SemanticNode } from "@/lib/types";

type SearchResponse = {
  results: SearchResult[];
  nodes: SemanticNode[];
};

export function SearchBar() {
  const t = useTranslations("search");
  const query = useAtlasStore((state) => state.query);
  const activeQuery = useAtlasStore((state) => state.activeQuery);
  const filters = useAtlasStore((state) => state.filters);
  const granularity = useAtlasStore((state) => state.granularity);
  const setQuery = useAtlasStore((state) => state.setQuery);
  const setActiveQuery = useAtlasStore((state) => state.setActiveQuery);
  const setResults = useAtlasStore((state) => state.setResults);
  const setNodes = useAtlasStore((state) => state.setNodes);
  const setGranularity = useAtlasStore((state) => state.setGranularity);
  const setMapMode = useAtlasStore((state) => state.setMapMode);
  const setPassageScopePrompt = useAtlasStore((state) => state.setPassageScopePrompt);
  const selectPassage = useAtlasStore((state) => state.selectPassage);
  const results = useAtlasStore((state) => state.results);
  const [busy, setBusy] = useState(false);
  const [searchRequestId, setSearchRequestId] = useState(0);
  const exampleQueries = useMemo(
    () => [...t.raw("examples.expressions"), ...t.raw("examples.questions")] as string[],
    [t]
  );
  const hasActiveSearch = useMemo(() => hasTextSearch(activeQuery), [activeQuery]);
  const queryLength = countCodePoints(query.trim());
  const queryTooLong = queryLength > FREE_TEXT_MAX_CODE_POINTS;
  const canSubmitSearch = hasTextSearch(query) && !queryTooLong;

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      if (granularity === "passage" && !hasPassageNodeScope(activeQuery, filters)) {
        setNodes([]);
        setResults([]);
        selectPassage(null);
        setPassageScopePrompt(true);
        setBusy(false);
        return;
      }
      setPassageScopePrompt(false);
      setBusy(true);
      const params = new URLSearchParams({ q: activeQuery, nodeLevel: granularity });
      appendFiltersToParams(params, filters);
      try {
        const response = await fetch(`/api/search?${params.toString()}`);
        const payload = (await response.json()) as SearchResponse;
        if (cancelled) {
          return;
        }
        const nextResults = hasActiveSearch ? payload.results ?? [] : [];
        setResults(nextResults);
        setNodes(payload.nodes ?? []);
        setMapMode(hasActiveSearch ? "isolate" : "highlight");
        selectPassage(hasActiveSearch ? nextResults[0]?.id ?? null : null);
        if (hasActiveSearch && granularity !== "passage" && shouldAutoOpenPassageMap(nextResults)) {
          setGranularity("passage");
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    activeQuery,
    filters,
    granularity,
    hasActiveSearch,
    selectPassage,
    setMapMode,
    setNodes,
    setPassageScopePrompt,
    setResults,
    setGranularity,
    searchRequestId
  ]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitSearch) {
      return;
    }
    setBusy(true);
    setPassageScopePrompt(false);
    setActiveQuery(query);
    setSearchRequestId((current) => current + 1);
  }

  return (
    <section className="col-span-full border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <form className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center" onSubmit={submitSearch}>
          <div className="min-w-0 flex-1">
            <input
              aria-invalid={queryTooLong}
              className="h-10 w-full border border-[var(--line)] bg-white px-3 text-sm aria-[invalid=true]:border-red-500"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("retrievalPlaceholder")}
              value={query}
            />
            <div className={`mt-1 text-xs ${queryTooLong ? "text-red-700" : "text-neutral-500"}`}>
              {queryTooLong
                ? t("limitExceeded", { count: queryLength, limit: FREE_TEXT_MAX_CODE_POINTS })
                : t("limitCounter", { count: queryLength, limit: FREE_TEXT_MAX_CODE_POINTS })}
            </div>
          </div>
          <button
            className="h-10 w-full border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"
            disabled={busy || !canSubmitSearch}
            type="submit"
          >
            {busy ? t("searching") : t("button")}
          </button>
          <div className="w-full text-left text-xs text-neutral-600 sm:w-24 sm:text-right">
            {busy ? t("searching") : t("results", { count: results.length })}
          </div>
        </form>
        <div className="flex max-w-3xl flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-neutral-500">{t("examplesLabel")}</span>
          {exampleQueries.map((example) => (
            <button
              className="rounded-full border border-[var(--line)] bg-white px-2 py-1 text-neutral-700 hover:border-[var(--accent)] hover:text-[var(--accent)]"
              key={example}
              onClick={() => setQuery(example)}
              type="button"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
