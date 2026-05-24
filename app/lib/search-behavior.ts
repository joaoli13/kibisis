import type { SearchFilters } from "./types";

type PassageNodeScopeOptions = {
  cursor?: string | null;
  overview?: string | null;
  page?: string | null;
};

export function hasTextSearch(query: string): boolean {
  return Boolean(query.trim());
}

export function hasMetadataScope(filters: SearchFilters): boolean {
  return Object.values(filters).some(Boolean);
}

export function hasPassageNodeScope(
  query: string,
  filters: SearchFilters,
  options: PassageNodeScopeOptions = {}
): boolean {
  return Boolean(
    hasTextSearch(query) ||
      filters.author ||
      filters.work ||
      options.cursor ||
      options.page ||
      options.overview === "sample"
  );
}
