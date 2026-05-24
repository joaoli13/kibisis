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
