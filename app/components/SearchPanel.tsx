"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAtlasStore } from "@/stores/atlas";
import { hasTextSearch } from "@/lib/search-behavior";
import type { FacetOption, MetadataFacets, SearchFilters } from "@/lib/types";

type MetadataResponse = {
  facets: MetadataFacets;
};

const emptyFacets: MetadataFacets = {
  authors: [],
  works: [],
  genres: [],
  periods: [],
  languages: [],
  textTypes: []
};

const filterFields: Array<{
  key: keyof SearchFilters;
  labelKey: keyof SearchFilters;
  optionsKey: keyof MetadataFacets;
}> = [
  { key: "genre", labelKey: "genre", optionsKey: "genres" },
  { key: "author", labelKey: "author", optionsKey: "authors" },
  { key: "work", labelKey: "work", optionsKey: "works" },
  { key: "period", labelKey: "period", optionsKey: "periods" },
  { key: "language", labelKey: "language", optionsKey: "languages" },
  { key: "textType", labelKey: "textType", optionsKey: "textTypes" }
];

const facetValueMessageKeys: Partial<Record<keyof SearchFilters, Record<string, string>>> = {
  genre: {
    biography: "filters.values.genre.biography",
    comedy: "filters.values.genre.comedy",
    epic: "filters.values.genre.epic",
    geography: "filters.values.genre.geography",
    history: "filters.values.genre.history",
    medicine: "filters.values.genre.medicine",
    miscellany: "filters.values.genre.miscellany",
    philosophy: "filters.values.genre.philosophy",
    poetry: "filters.values.genre.poetry",
    religion: "filters.values.genre.religion",
    rhetoric: "filters.values.genre.rhetoric",
    satire: "filters.values.genre.satire",
    tragedy: "filters.values.genre.tragedy"
  },
  period: {
    archaic: "filters.values.period.archaic",
    classical: "filters.values.period.classical",
    hellenistic: "filters.values.period.hellenistic",
    roman: "filters.values.period.roman"
  },
  language: {
    en: "filters.values.language.en",
    eng: "filters.values.language.eng",
    fre: "filters.values.language.fre",
    grc: "filters.values.language.grc",
    ita: "filters.values.language.ita",
    la: "filters.values.language.la",
    lat: "filters.values.language.lat",
    unknown: "filters.values.language.unknown"
  },
  textType: {
    original: "filters.values.textType.original",
    translation: "filters.values.textType.translation"
  }
};

function localizedOptionLabel(key: keyof SearchFilters, option: FacetOption, translate: (key: string) => string) {
  const valueKey = option.id.toLowerCase();
  const messageKey = facetValueMessageKeys[key]?.[valueKey];
  return messageKey ? translate(messageKey) : option.label;
}

function optionLabel(
  options: FacetOption[],
  value: string | undefined,
  key: keyof SearchFilters,
  translate: (key: string) => string
) {
  const option = options.find((candidate) => candidate.id === value);
  return option ? localizedOptionLabel(key, option, translate) : value;
}

function optionsFor(key: keyof SearchFilters, facets: MetadataFacets, filters: SearchFilters) {
  if (key === "work" && filters.author) {
    return facets.works.filter((work) => work.author_id === filters.author);
  }
  return facets[filterFields.find((field) => field.key === key)?.optionsKey ?? "authors"];
}

function normalizeFilters(filters: SearchFilters, facets: MetadataFacets): SearchFilters {
  const next: SearchFilters = { ...filters };
  filterFields.forEach(({ key }) => {
    const value = next[key];
    if (!value) {
      return;
    }
    const options = optionsFor(key, facets, next);
    if (!options.some((option) => option.id === value)) {
      next[key] = undefined;
    }
  });
  filterFields.forEach(({ key }) => {
    if (next[key]) {
      return;
    }
    const options = optionsFor(key, facets, next);
    if (options.length === 1) {
      next[key] = options[0]?.id;
    }
  });
  return next;
}

function filtersEqual(a: SearchFilters, b: SearchFilters) {
  return filterFields.every(({ key }) => (a[key] ?? "") === (b[key] ?? ""));
}

export function SearchPanel() {
  const t = useTranslations();
  const query = useAtlasStore((state) => state.query);
  const activeQuery = useAtlasStore((state) => state.activeQuery);
  const filters = useAtlasStore((state) => state.filters);
  const setQuery = useAtlasStore((state) => state.setQuery);
  const setActiveQuery = useAtlasStore((state) => state.setActiveQuery);
  const setFilters = useAtlasStore((state) => state.setFilters);
  const setPassageScopePrompt = useAtlasStore((state) => state.setPassageScopePrompt);
  const setResults = useAtlasStore((state) => state.setResults);
  const selectPassage = useAtlasStore((state) => state.selectPassage);
  const [facets, setFacets] = useState<MetadataFacets>(emptyFacets);

  useEffect(() => {
    let cancelled = false;
    async function loadMetadata() {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        }
      });
      const response = await fetch(`/api/metadata?${params.toString()}`);
      const payload = (await response.json()) as MetadataResponse;
      if (!cancelled) {
        const nextFacets = payload.facets ?? emptyFacets;
        setFacets(nextFacets);
        const nextFilters = normalizeFilters(filters, nextFacets);
        if (!filtersEqual(filters, nextFilters)) {
          setFilters(nextFilters);
        }
      }
    }
    loadMetadata().catch(() => {
      if (!cancelled) {
        setFacets(emptyFacets);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filters, setFilters]);

  const visibleWorks = filters.author
    ? facets.works.filter((work) => work.author_id === filters.author)
    : facets.works;
  const activeFilters = filterFields.filter(({ key }) => Boolean(filters[key]));
  const displayedSearchQuery = activeQuery.trim() || query.trim();
  const hasSearchQuery = hasTextSearch(displayedSearchQuery);
  const hasAnyActiveFilter = activeFilters.length > 0 || hasSearchQuery;

  function clearAllFilters() {
    setFilters({});
    setQuery("");
    setActiveQuery("");
    setResults([]);
    setPassageScopePrompt(false);
    selectPassage(null);
  }

  return (
    <aside className="h-full overflow-auto border-r border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="space-y-3">
        <section className="rounded border border-[var(--line)] bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("filters.selected")}</h2>
            {hasAnyActiveFilter ? (
              <button className="text-xs text-[var(--accent)] hover:underline" onClick={clearAllFilters} type="button">
                {t("filters.clear")}
              </button>
            ) : null}
          </div>
          {hasAnyActiveFilter ? (
            <div className="flex flex-wrap gap-2">
              {hasSearchQuery ? (
                <button
                  className="max-w-full truncate rounded border border-[var(--line)] px-2 py-1 text-xs text-neutral-700 hover:border-[var(--accent)]"
                  onClick={() => {
                    setQuery("");
                    setActiveQuery("");
                    setResults([]);
                    setPassageScopePrompt(false);
                    selectPassage(null);
                  }}
                  type="button"
                >
                  {t("filters.searchQuery")}: {displayedSearchQuery} x
                </button>
              ) : null}
              {activeFilters.map(({ key, labelKey, optionsKey }) => {
                const options = key === "work" ? facets.works : facets[optionsKey];
                const label = t(`filters.fields.${labelKey}`);
                return (
                  <button
                    className="max-w-full truncate rounded border border-[var(--line)] px-2 py-1 text-xs text-neutral-700 hover:border-[var(--accent)]"
                    key={key}
                    onClick={() => {
                      if (key === "author") {
                        setPassageScopePrompt(false);
                        setFilters({ ...filters, author: undefined, work: undefined });
                        return;
                      }
                      setPassageScopePrompt(false);
                      setFilters({ ...filters, [key]: undefined });
                    }}
                    type="button"
                  >
                    {label}: {optionLabel(options, filters[key], key, t)} x
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-neutral-500">{t("filters.noneSelected")}</div>
          )}
        </section>

        <section className="rounded border border-[var(--line)] bg-white p-3">
          <div className="mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">{t("filters.metadata")}</h2>
          </div>
          <div className="space-y-3">
            {filterFields.map(({ key, labelKey, optionsKey }) => {
              const options = key === "work" ? visibleWorks : facets[optionsKey];
              const label = t(`filters.fields.${labelKey}`);
              return (
                <label className="block" key={key}>
                  <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
                  <select
                    className="w-full border border-[var(--line)] bg-white px-2 py-2 text-sm"
                    disabled={!options.length || (key === "work" && Boolean(filters.author) && !visibleWorks.length)}
                    onChange={(event) => {
                      const value = event.target.value || undefined;
                      if (key === "author") {
                        setPassageScopePrompt(false);
                        setFilters({ ...filters, author: value, work: undefined });
                        return;
                      }
                      setPassageScopePrompt(false);
                      setFilters({ ...filters, [key]: value });
                    }}
                    value={filters[key] ?? ""}
                  >
                    <option value="">{t(`filters.all.${labelKey}`)}</option>
                    {options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {localizedOptionLabel(key, option, t)}
                        {typeof option.count === "number" ? ` (${option.count})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
