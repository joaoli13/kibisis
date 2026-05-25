import { filterKeys, valuesForFilter } from "./filters";
import type { NodeLevel, SearchFilters } from "./types";

export const FREE_TEXT_MAX_CODE_POINTS = 2000;
export const FACET_QUERY_MAX_CODE_POINTS = 100;
export const ID_MAX_CODE_POINTS = 160;
export const FILTER_VALUE_MAX_CODE_POINTS = 160;
export const FILTER_VALUES_MAX_PER_FIELD = 20;
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 100;
export const METADATA_LIMIT_DEFAULT = 20;
export const METADATA_LIMIT_MAX = 100;
export const SYNTHESIS_PASSAGE_LIMIT = 7;
export const SYNTHESIS_BODY_MAX_BYTES = 16_384;

export type ValidationFailure = {
  error: string;
  status: 400 | 413;
  field?: string;
  count?: number;
  limit?: number;
};

const nodeLevels = new Set<NodeLevel>(["author", "work", "passage"]);
const metadataFacets = new Set(["author", "work", "genre", "period", "language", "textType"]);
const metadataScopes = new Set(["compatible", "corpus"]);
const noControlCharacters = /^[^\u0000-\u001f\u007f]*$/u;

export function countCodePoints(value: string): number {
  return [...value].length;
}

export function trimmedString(value: string): string {
  return value.trim();
}

export function validateFreeText(value: string, field: string): ValidationFailure | null {
  const count = countCodePoints(trimmedString(value));
  if (count > FREE_TEXT_MAX_CODE_POINTS) {
    return { error: "input_too_long", status: 400, field, count, limit: FREE_TEXT_MAX_CODE_POINTS };
  }
  return null;
}

export function validateFacetQuery(value: string | null | undefined, field: string): ValidationFailure | null {
  if (!value) {
    return null;
  }
  const count = countCodePoints(trimmedString(value));
  if (count > FACET_QUERY_MAX_CODE_POINTS) {
    return { error: "input_too_long", status: 400, field, count, limit: FACET_QUERY_MAX_CODE_POINTS };
  }
  if (!noControlCharacters.test(value)) {
    return { error: "invalid_input", status: 400, field };
  }
  return null;
}

export function parseBoundedInteger(
  value: string | null,
  field: string,
  defaultValue: number,
  max: number,
  min = 1
): { value: number; error: ValidationFailure | null } {
  if (value === null || value.trim() === "") {
    return { value: defaultValue, error: null };
  }
  if (!/^\d+$/.test(value.trim())) {
    return { value: defaultValue, error: { error: "invalid_limit", status: 400, field } };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    return { value: defaultValue, error: { error: "invalid_limit", status: 400, field } };
  }
  return { value: Math.min(parsed, max), error: null };
}

export function parseNodeLevel(value: string | null): { value: NodeLevel; error: ValidationFailure | null } {
  if (!value) {
    return { value: "author", error: null };
  }
  if (!nodeLevels.has(value as NodeLevel)) {
    return { value: "author", error: { error: "invalid_node_level", status: 400, field: "nodeLevel" } };
  }
  return { value: value as NodeLevel, error: null };
}

export function parseMetadataFacet(value: string | null): { value: string | undefined; error: ValidationFailure | null } {
  if (!value) {
    return { value: undefined, error: null };
  }
  if (!metadataFacets.has(value)) {
    return { value: undefined, error: { error: "invalid_facet", status: 400, field: "facet" } };
  }
  return {
    value:
      value === "author"
        ? "authors"
        : value === "work"
          ? "works"
          : value === "genre"
            ? "genres"
            : value === "period"
              ? "periods"
              : value === "language"
                ? "languages"
                : "textTypes",
    error: null
  };
}

export function parseMetadataScope(value: string | null): { value: "compatible" | "corpus"; error: ValidationFailure | null } {
  if (!value) {
    return { value: "compatible", error: null };
  }
  if (!metadataScopes.has(value)) {
    return { value: "compatible", error: { error: "invalid_scope", status: 400, field: "scope" } };
  }
  return { value: value as "compatible" | "corpus", error: null };
}

export function validateId(value: string, field: string): ValidationFailure | null {
  const count = countCodePoints(value);
  if (count < 1 || count > ID_MAX_CODE_POINTS) {
    return { error: "invalid_id", status: 400, field, count, limit: ID_MAX_CODE_POINTS };
  }
  if (!noControlCharacters.test(value)) {
    return { error: "invalid_id", status: 400, field };
  }
  return null;
}

export function validateSearchFilters(filters: SearchFilters): ValidationFailure | null {
  for (const key of filterKeys) {
    const values = valuesForFilter(filters[key]);
    if (values.length > FILTER_VALUES_MAX_PER_FIELD) {
      return { error: "too_many_filter_values", status: 400, field: key, count: values.length, limit: FILTER_VALUES_MAX_PER_FIELD };
    }
    for (const value of values) {
      const count = countCodePoints(value);
      if (count > FILTER_VALUE_MAX_CODE_POINTS || !noControlCharacters.test(value)) {
        return { error: "invalid_filter", status: 400, field: key, count, limit: FILTER_VALUE_MAX_CODE_POINTS };
      }
    }
  }
  return null;
}

export function validatePassageScopeParams(searchParams: URLSearchParams): ValidationFailure | null {
  const cursor = searchParams.get("cursor");
  const overview = searchParams.get("overview");
  const page = searchParams.get("page");
  if (cursor && validateId(cursor, "cursor")) {
    return { error: "invalid_cursor", status: 400, field: "cursor" };
  }
  if (overview && overview !== "sample") {
    return { error: "invalid_overview", status: 400, field: "overview" };
  }
  if (page !== null && !/^\d+$/.test(page)) {
    return { error: "invalid_page", status: 400, field: "page" };
  }
  return null;
}

export function jsonByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
