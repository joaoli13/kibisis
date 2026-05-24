import { NextRequest, NextResponse } from "next/server";
import {
  dataSource,
  getNodes,
  getNodesForResultSet,
  getSampledNodes,
  isDatabaseConfigurationError,
  searchPassages
} from "@/lib/db";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";
import { hasPassageNodeScope, hasTextSearch } from "@/lib/search-behavior";
import type { NodeLevel, SearchFilters } from "@/lib/types";

const nodeLevels = new Set<NodeLevel>(["author", "work", "passage"]);

function readFilters(url: URL): SearchFilters {
  return {
    author: url.searchParams.get("author") ?? undefined,
    work: url.searchParams.get("work") ?? undefined,
    genre: url.searchParams.get("genre") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
    language: url.searchParams.get("language") ?? undefined,
    textType: url.searchParams.get("textType") ?? undefined
  };
}

function readNodeLevel(url: URL): NodeLevel {
  const value = url.searchParams.get("nodeLevel");
  return value && nodeLevels.has(value as NodeLevel) ? (value as NodeLevel) : "author";
}

export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "search");
  if (limited) {
    return limited;
  }
  const started = Date.now();
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const nodeLevel = readNodeLevel(url);
  const filters = readFilters(url);
  const shouldSearch = hasTextSearch(query);
  const passageScopeOptions = {
    cursor: url.searchParams.get("cursor"),
    overview: url.searchParams.get("overview"),
    page: url.searchParams.get("page")
  };
  let statusCode = 200;
  try {
    const results = shouldSearch ? await searchPassages(query, filters, Number.isFinite(limit) ? limit : 20) : [];
    if (nodeLevel === "passage" && !hasPassageNodeScope(query, filters, passageScopeOptions)) {
      return NextResponse.json(
        withProvenance({ results, nodes: [], warning: "passage_scope_required" }),
        { headers: { "x-perseus-data-source": dataSource() } }
      );
    }
    const nodes =
      nodeLevel === "passage" && shouldSearch
        ? await getNodesForResultSet(nodeLevel, results)
        : nodeLevel === "passage" && passageScopeOptions.overview === "sample"
          ? await getSampledNodes(nodeLevel, filters)
          : await getNodes(nodeLevel, filters);
    return NextResponse.json(withProvenance({ results, nodes }), {
      headers: { "x-perseus-data-source": dataSource() }
    });
  } catch (error) {
    statusCode = isDatabaseConfigurationError(error) ? 503 : 500;
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
      queryLength: query.length,
      dataSource: dataSource()
    });
  }
}
