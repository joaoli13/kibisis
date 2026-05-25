import { NextRequest, NextResponse } from "next/server";
import {
  dataSource,
  getNodes,
  getNodesForResultSet,
  getSampledNodes,
  isDatabaseConfigurationError,
  searchPassages
} from "@/lib/db";
import { readFiltersFromSearchParams } from "@/lib/filters";
import {
  countCodePoints,
  parseBoundedInteger,
  parseNodeLevel,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  validateFreeText,
  validatePassageScopeParams,
  validateSearchFilters,
  type ValidationFailure
} from "@/lib/input-limits";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";
import { hasPassageNodeScope, hasTextSearch } from "@/lib/search-behavior";

function validationResponse(error: ValidationFailure) {
  return NextResponse.json(error, { status: error.status });
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  let statusCode = 200;
  let errorCode: string | undefined;
  const limited = rateLimit(request, "search");
  if (limited) {
    statusCode = 429;
    errorCode = "rate_limited";
    logRequest({ request, route: "/api/search", statusCode, latencyMs: Date.now() - started, errorCode, dataSource: dataSource() });
    return limited;
  }
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limit = parseBoundedInteger(url.searchParams.get("limit"), "limit", SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
  const nodeLevel = parseNodeLevel(url.searchParams.get("nodeLevel"));
  const filters = readFiltersFromSearchParams(url.searchParams);
  const shouldSearch = hasTextSearch(query);
  const passageScopeOptions = {
    cursor: url.searchParams.get("cursor"),
    overview: url.searchParams.get("overview"),
    page: url.searchParams.get("page")
  };
  try {
    const validationError =
      validateFreeText(query, "q") ??
      limit.error ??
      nodeLevel.error ??
      validateSearchFilters(filters) ??
      validatePassageScopeParams(url.searchParams);
    if (validationError) {
      statusCode = validationError.status;
      errorCode = validationError.error;
      return validationResponse(validationError);
    }

    const results = shouldSearch ? await searchPassages(query.trim(), filters, limit.value) : [];
    if (nodeLevel.value === "passage" && !hasPassageNodeScope(query, filters, passageScopeOptions)) {
      return NextResponse.json(
        withProvenance({ results, nodes: [], warning: "passage_scope_required" }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    }
    const nodes =
      nodeLevel.value === "passage" && shouldSearch
        ? await getNodesForResultSet(nodeLevel.value, results)
        : nodeLevel.value === "passage" && passageScopeOptions.overview === "sample"
          ? await getSampledNodes(nodeLevel.value, filters)
          : await getNodes(nodeLevel.value, filters);
    return NextResponse.json(withProvenance({ results, nodes }), {
      headers: { "x-perseus-data-source": dataSource() }
    });
  } catch (error) {
    statusCode = isDatabaseConfigurationError(error) ? 503 : 500;
    errorCode = isDatabaseConfigurationError(error) ? "database_not_configured" : "search_failed";
    return NextResponse.json(
      { error: isDatabaseConfigurationError(error) ? "database_not_configured" : "search_failed" },
      { status: statusCode }
    );
  } finally {
    logRequest({
      request,
      route: "/api/search",
      statusCode,
      latencyMs: Date.now() - started,
      queryLength: countCodePoints(query),
      errorCode,
      dataSource: dataSource()
    });
  }
}
