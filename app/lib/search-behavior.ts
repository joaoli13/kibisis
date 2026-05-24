import type { SearchFilters } from "./types";
import { hasAnyMetadataFilter, valuesForFilter } from "./filters";

type PassageNodeScopeOptions = {
  cursor?: string | null;
  overview?: string | null;
  page?: string | null;
};

export function hasTextSearch(query: string): boolean {
  return Boolean(query.trim());
}

export function hasMetadataScope(filters: SearchFilters): boolean {
  return hasAnyMetadataFilter(filters);
}

export function hasPassageNodeScope(
  query: string,
  filters: SearchFilters,
  options: PassageNodeScopeOptions = {}
): boolean {
  return Boolean(
      hasTextSearch(query) ||
      valuesForFilter(filters.author).length ||
      valuesForFilter(filters.work).length ||
      options.cursor ||
      options.page ||
      options.overview === "sample"
  );
}

export function shouldAutoOpenPassageMap(
  results: Array<{ author_id?: string | null; work_id?: string | null }>
): boolean {
  if (!results.length) {
    return false;
  }
  const authorIds = new Set(results.map((result) => result.author_id).filter(Boolean));
  const workIds = new Set(results.map((result) => result.work_id).filter(Boolean));
  return authorIds.size === 1 && workIds.size === 1;
}
