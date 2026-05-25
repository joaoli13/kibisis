import { NextRequest, NextResponse } from "next/server";
import { dataSource, getMetadataFacets, getMetadataSummary, isDatabaseConfigurationError } from "@/lib/db";
import { readFiltersFromSearchParams } from "@/lib/filters";
import {
  countCodePoints,
  METADATA_LIMIT_DEFAULT,
  METADATA_LIMIT_MAX,
  parseBoundedInteger,
  parseMetadataFacet,
  parseMetadataScope,
  validateFacetQuery,
  validateSearchFilters,
  type ValidationFailure
} from "@/lib/input-limits";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";
import type { MetadataFacets } from "@/lib/types";

function validationResponse(error: ValidationFailure) {
  return NextResponse.json(error, { status: error.status });
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  let statusCode = 200;
  let errorCode: string | undefined;
  const limited = rateLimit(request, "metadata");
  if (limited) {
    statusCode = 429;
    errorCode = "rate_limited";
    logRequest({ request, route: "/api/metadata", statusCode, latencyMs: Date.now() - started, errorCode, dataSource: dataSource() });
    return limited;
  }
  const url = new URL(request.url);
  const facet = parseMetadataFacet(url.searchParams.get("facet"));
  const scope = parseMetadataScope(url.searchParams.get("scope"));
  const limit = parseBoundedInteger(url.searchParams.get("limit"), "limit", METADATA_LIMIT_DEFAULT, METADATA_LIMIT_MAX);
  const filters = readFiltersFromSearchParams(url.searchParams);
  const facetQuery = url.searchParams.get("facetQuery") ?? undefined;
  const authorQuery = url.searchParams.get("authorQuery") ?? undefined;
  const workQuery = url.searchParams.get("workQuery") ?? undefined;
  try {
    const dashboard = url.searchParams.get("dashboard") === "true";
    const includeSummary = dashboard || url.searchParams.get("summary") === "true";
    const includeTotalSummary = includeSummary && url.searchParams.get("totalSummary") === "true";
    const validationError =
      validateSearchFilters(filters) ??
      facet.error ??
      scope.error ??
      limit.error ??
      validateFacetQuery(facetQuery, "facetQuery") ??
      validateFacetQuery(authorQuery, "authorQuery") ??
      validateFacetQuery(workQuery, "workQuery");
    if (validationError) {
      statusCode = validationError.status;
      errorCode = validationError.error;
      return validationResponse(validationError);
    }
    const [facets, summary, totalSummary] = await Promise.all([
      getMetadataFacets(filters, {
        dashboard,
        scope: scope.value,
        facet: facet.value as keyof MetadataFacets | undefined,
        facetQuery,
        authorQuery,
        workQuery,
        limit: limit.value
      }),
      includeSummary ? getMetadataSummary(filters) : Promise.resolve(undefined),
      includeTotalSummary ? getMetadataSummary({}) : Promise.resolve(undefined)
    ]);
    return NextResponse.json(withProvenance({
      facets,
      ...(summary ? { summary } : {}),
      ...(totalSummary ? { totalSummary } : {})
    }), {
      headers: { "x-perseus-data-source": dataSource() }
    });
  } catch (error) {
    statusCode = isDatabaseConfigurationError(error) ? 503 : 500;
    errorCode = isDatabaseConfigurationError(error) ? "database_not_configured" : "metadata_failed";
    return NextResponse.json(
      { error: isDatabaseConfigurationError(error) ? "database_not_configured" : "metadata_failed" },
      { status: statusCode }
    );
  } finally {
    logRequest({
      request,
      route: "/api/metadata",
      statusCode,
      latencyMs: Date.now() - started,
      queryLength: Math.max(
        countCodePoints(facetQuery ?? ""),
        countCodePoints(authorQuery ?? ""),
        countCodePoints(workQuery ?? "")
      ),
      errorCode,
      dataSource: dataSource()
    });
  }
}
