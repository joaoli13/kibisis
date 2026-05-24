import type { SearchFilterValue, SearchFilters } from "./types";

export const filterKeys = ["genre", "author", "work", "period", "language", "textType"] as const;

export type FilterKey = (typeof filterKeys)[number];

export function valuesForFilter(value: SearchFilterValue | undefined): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : [];
}

export function normalizeFilterValue(value: SearchFilterValue | undefined): SearchFilterValue | undefined {
  const values = valuesForFilter(value);
  if (!values.length) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}

export function normalizeSearchFilters(filters: SearchFilters = {}): SearchFilters {
  return filterKeys.reduce<SearchFilters>((next, key) => {
    const value = normalizeFilterValue(filters[key]);
    if (value !== undefined) {
      next[key] = value;
    }
    return next;
  }, {});
}

export function filterHasValue(filters: SearchFilters, key: FilterKey, value: string): boolean {
  return valuesForFilter(filters[key]).includes(value);
}

export function setFilterValue(filters: SearchFilters, key: FilterKey, value: SearchFilterValue | undefined): SearchFilters {
  const next = { ...filters };
  const normalized = normalizeFilterValue(value);
  if (normalized === undefined) {
    delete next[key];
  } else {
    next[key] = normalized;
  }
  if (key === "author") {
    delete next.work;
  }
  return next;
}

export function toggleFilterValue(filters: SearchFilters, key: FilterKey, value: string): SearchFilters {
  const values = valuesForFilter(filters[key]);
  const nextValues = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  return setFilterValue(filters, key, nextValues);
}

export function removeFilterValue(filters: SearchFilters, key: FilterKey, value: string): SearchFilters {
  return setFilterValue(filters, key, valuesForFilter(filters[key]).filter((item) => item !== value));
}

export function clearFilterKey(filters: SearchFilters, key: FilterKey): SearchFilters {
  return setFilterValue(filters, key, undefined);
}

export function firstFilterValue(value: SearchFilterValue | undefined): string | undefined {
  return valuesForFilter(value)[0];
}

export function onlyFilterValue(value: SearchFilterValue | undefined): string | undefined {
  const values = valuesForFilter(value);
  return values.length === 1 ? values[0] : undefined;
}

export function hasAnyMetadataFilter(filters: SearchFilters): boolean {
  return filterKeys.some((key) => valuesForFilter(filters[key]).length > 0);
}

export function appendFiltersToParams(params: URLSearchParams, filters: SearchFilters) {
  filterKeys.forEach((key) => {
    valuesForFilter(filters[key]).forEach((value) => params.append(key, value));
  });
}

export function readFiltersFromSearchParams(searchParams: URLSearchParams): SearchFilters {
  return normalizeSearchFilters(
    filterKeys.reduce<SearchFilters>((filters, key) => {
      const values = searchParams.getAll(key).filter(Boolean);
      if (values.length === 1) {
        filters[key] = values[0];
      } else if (values.length > 1) {
        filters[key] = values;
      }
      return filters;
    }, {})
  );
}
