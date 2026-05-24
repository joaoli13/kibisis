"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Canvas3D } from "@/components/Canvas3D";
import {
  appendFiltersToParams,
  clearFilterKey,
  filterHasValue,
  normalizeSearchFilters,
  toggleFilterValue,
  valuesForFilter
} from "@/lib/filters";
import type { FacetOption, MetadataFacets, MetadataSummary, SearchFilters } from "@/lib/types";

type MetadataResponse = {
  facets: MetadataFacets;
  summary?: MetadataSummary;
};

type FilterDashboardProps = {
  facets: MetadataFacets;
  filters: SearchFilters;
  onApply: (filters: SearchFilters) => void;
  onClose: () => void;
  translateOption: (key: keyof SearchFilters, option: FacetOption, translate: (key: string) => string) => string;
};

const emptyFacets: MetadataFacets = {
  authors: [],
  works: [],
  genres: [],
  periods: [],
  languages: [],
  textTypes: []
};

const emptySummary: MetadataSummary = {
  authors_count: 0,
  works_count: 0,
  passages_count: 0
};

const facetGroups: Array<{
  key: keyof SearchFilters;
  facetsKey: keyof MetadataFacets;
  visual: "bars" | "timeline" | "chips" | "segments" | "list";
}> = [
  { key: "genre", facetsKey: "genres", visual: "bars" },
  { key: "period", facetsKey: "periods", visual: "timeline" },
  { key: "language", facetsKey: "languages", visual: "chips" },
  { key: "textType", facetsKey: "textTypes", visual: "segments" },
  { key: "author", facetsKey: "authors", visual: "list" },
  { key: "work", facetsKey: "works", visual: "list" }
];

function maxCount(options: FacetOption[]) {
  return Math.max(1, ...options.map((option) => option.count ?? option.work_count ?? option.passage_count ?? 0));
}

function optionCount(option: FacetOption) {
  return option.count ?? option.work_count ?? option.passage_count ?? 0;
}

export function FilterDashboard({ facets, filters, onApply, onClose, translateOption }: FilterDashboardProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState<SearchFilters>(() => normalizeSearchFilters(filters));
  const [scope, setScope] = useState<"compatible" | "corpus">("compatible");
  const [authorQuery, setAuthorQuery] = useState("");
  const [workQuery, setWorkQuery] = useState("");
  const [dashboardFacets, setDashboardFacets] = useState<MetadataFacets>(facets);
  const [dashboardSummary, setDashboardSummary] = useState<MetadataSummary>(emptySummary);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"filters" | "map">("filters");
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setBusy(true);
      const params = new URLSearchParams({ dashboard: "true", scope, limit: "20" });
      appendFiltersToParams(params, draft);
      if (authorQuery.trim()) {
        params.set("facetQuery", authorQuery.trim());
      } else if (workQuery.trim()) {
        params.set("facetQuery", workQuery.trim());
      }
      try {
        const response = await fetch(`/api/metadata?${params.toString()}`);
        const payload = (await response.json()) as MetadataResponse;
        if (!cancelled) {
          setDashboardFacets(payload.facets ?? emptyFacets);
          setDashboardSummary(payload.summary ?? emptySummary);
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardFacets(emptyFacets);
          setDashboardSummary(emptySummary);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [authorQuery, draft, scope, workQuery]);

  const selectedItems = useMemo(
    () =>
      facetGroups.flatMap(({ key, facetsKey }) =>
        valuesForFilter(draft[key]).map((value) => {
          const option = dashboardFacets[facetsKey].find((candidate) => candidate.id === value);
          return { key, value, label: option ? translateOption(key, option, t) : value };
        })
      ),
    [dashboardFacets, draft, t, translateOption]
  );

  function toggle(key: keyof SearchFilters, value: string) {
    setDraft((current) => toggleFilterValue(current, key, value));
  }

  function clearDimension(key: keyof SearchFilters) {
    setDraft((current) => clearFilterKey(current, key));
  }

  function renderOptions(key: keyof SearchFilters, options: FacetOption[], visual: string) {
    const maximum = maxCount(options);
    if (!options.length) {
      return <div className="text-sm text-neutral-500">{t("filterDashboard.noOptions")}</div>;
    }
    return (
      <div className={visual === "segments" ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
        {options.map((option) => {
          const selected = filterHasValue(draft, key, option.id);
          const compatible = option.compatible !== false;
          const width = `${Math.max(8, Math.round((optionCount(option) / maximum) * 100))}%`;
          return (
            <button
              aria-pressed={selected}
              className={`group border p-2 text-left transition ${
                selected
                  ? "border-[var(--accent)] bg-[var(--surface-muted)]"
                  : compatible
                    ? "border-[var(--line)] bg-white hover:border-[var(--accent)]"
                    : "border-[var(--line)] bg-neutral-50 text-neutral-400"
              }`}
              key={option.id}
              onClick={() => toggle(key, option.id)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{translateOption(key, option, t)}</span>
                <span className="shrink-0 text-xs text-neutral-500">{optionCount(option)}</span>
              </div>
              {visual === "bars" || visual === "timeline" ? (
                <div className="mt-2 h-1.5 bg-[var(--surface-muted)]">
                  <div className="h-full bg-[var(--accent)]" style={{ width }} />
                </div>
              ) : null}
              {!compatible ? <div className="mt-1 text-[11px] text-neutral-400">{t("filterDashboard.outsideScope")}</div> : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-0 lg:p-6">
      <section className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl lg:mx-auto lg:max-w-7xl lg:rounded lg:border lg:border-[var(--line)]">
        <header className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{t("filterDashboard.eyebrow")}</div>
              <h2 className="mt-1 text-xl font-semibold">{t("filterDashboard.title")}</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">{t("filterDashboard.booleanHelp")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`border px-3 py-2 text-xs font-semibold ${view === "filters" ? "border-[var(--accent)] bg-white text-[var(--accent)]" : "border-[var(--line)] bg-white"}`}
                onClick={() => setView("filters")}
                type="button"
              >
                {t("filterDashboard.filtersTab")}
              </button>
              <button
                className={`border px-3 py-2 text-xs font-semibold ${view === "map" ? "border-[var(--accent)] bg-white text-[var(--accent)]" : "border-[var(--line)] bg-white"}`}
                onClick={() => setView("map")}
                type="button"
              >
                {t("filterDashboard.mapTab")}
              </button>
              <button className="border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold" onClick={onClose} type="button">
                {t("filterDashboard.cancel")}
              </button>
              <button
                className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
                onClick={() => onApply(draft)}
                type="button"
              >
                {t("filterDashboard.apply")}
              </button>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {view === "filters" ? (
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <main className="space-y-4">
                <section className="border border-[var(--line)] p-3">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("filterDashboard.scopeTitle")}</h3>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">{t("filterDashboard.scopeHelp")}</p>
                    </div>
                    <div className="grid overflow-hidden border border-[var(--line)] sm:grid-cols-2">
                      {(["compatible", "corpus"] as const).map((item) => (
                        <button
                          className={`px-3 py-2 text-xs font-semibold ${scope === item ? "bg-[var(--accent)] text-white" : "bg-white text-neutral-700"}`}
                          key={item}
                          onClick={() => setScope(item)}
                          type="button"
                        >
                          {t(`filterDashboard.scope.${item}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {busy ? <div className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{t("filterDashboard.loading")}</div> : null}
                </section>

                <div className="grid gap-4 lg:grid-cols-2">
                  {facetGroups.map(({ key, facetsKey, visual }) => (
                    <section className="border border-[var(--line)] bg-white p-3" key={key}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t(`filters.fields.${key}`)}</h3>
                          <p className="mt-1 text-xs text-neutral-500">
                            {key === "author"
                              ? t("filterDashboard.authorHelp")
                              : key === "work"
                                ? t("filterDashboard.workHelp")
                                : t("filterDashboard.dimensionHelp")}
                          </p>
                        </div>
                        {valuesForFilter(draft[key]).length ? (
                          <button className="text-xs font-semibold text-[var(--accent)] hover:underline" onClick={() => clearDimension(key)} type="button">
                            {t("filterDashboard.clearDimension")}
                          </button>
                        ) : null}
                      </div>
                      {key === "author" ? (
                        <input
                          className="mb-3 w-full border border-[var(--line)] px-2 py-2 text-sm"
                          onChange={(event) => setAuthorQuery(event.target.value)}
                          placeholder={t("filterDashboard.authorSearch")}
                          value={authorQuery}
                        />
                      ) : null}
                      {key === "work" ? (
                        <input
                          className="mb-3 w-full border border-[var(--line)] px-2 py-2 text-sm"
                          onChange={(event) => setWorkQuery(event.target.value)}
                          placeholder={t("filterDashboard.workSearch")}
                          value={workQuery}
                        />
                      ) : null}
                      {renderOptions(key, dashboardFacets[facetsKey], visual)}
                    </section>
                  ))}
                </div>
              </main>

              <aside className="space-y-4">
                <section className="border border-[var(--line)] bg-[var(--surface-muted)] p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("filterDashboard.summary")}</h3>
                  <div className="mt-2 text-sm text-neutral-600">
                    {numberFormatter.format(dashboardSummary.authors_count)} {t("filterDashboard.authors")} ·{" "}
                    {numberFormatter.format(dashboardSummary.works_count)} {t("filterDashboard.works")} ·{" "}
                    {numberFormatter.format(dashboardSummary.passages_count)} {t("resultsPanel.passages")}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedItems.map((item) => (
                      <button
                        className="max-w-full truncate border border-[var(--line)] bg-white px-2 py-1 text-xs text-neutral-700 hover:border-[var(--accent)]"
                        key={`${item.key}:${item.value}`}
                        onClick={() => setDraft((current) => toggleFilterValue(current, item.key, item.value))}
                        type="button"
                      >
                        {t(`filters.fields.${item.key}`)}: {item.label} x
                      </button>
                    ))}
                    {!selectedItems.length ? <div className="text-sm text-neutral-500">{t("filters.noneSelected")}</div> : null}
                  </div>
                </section>
                <section className="border border-[var(--line)] p-3 text-xs leading-5 text-neutral-600">
                  {t("filterDashboard.tooltip")}
                </section>
              </aside>
            </div>
          ) : (
            <div className="grid h-full min-h-[680px] gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-h-[560px] border border-[var(--line)]">
                <Canvas3D compact />
              </section>
              <aside className="border border-[var(--line)] bg-[var(--surface-muted)] p-4 text-sm leading-6 text-neutral-700">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("filterDashboard.mapTab")}</h3>
                <p className="mt-2">{t("filterDashboard.mapHelp")}</p>
              </aside>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
