import { NextRequest, NextResponse } from "next/server";
import { dataSource, getMetadataFacets, getMetadataSummary, isDatabaseConfigurationError } from "@/lib/db";
import { readFiltersFromSearchParams } from "@/lib/filters";
import { withProvenance } from "@/lib/provenance";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const facet = url.searchParams.get("facet") ?? undefined;
    const filters = readFiltersFromSearchParams(url.searchParams);
    const dashboard = url.searchParams.get("dashboard") === "true";
    const includeSummary = dashboard || url.searchParams.get("summary") === "true";
    const includeTotalSummary = includeSummary && url.searchParams.get("totalSummary") === "true";
    const [facets, summary, totalSummary] = await Promise.all([
      getMetadataFacets(filters, {
        dashboard,
        scope: url.searchParams.get("scope") === "corpus" ? "corpus" : "compatible",
        facet: facet === "author" ? "authors" : facet === "work" ? "works" : facet === "genre" ? "genres" : facet === "period" ? "periods" : facet === "language" ? "languages" : facet === "textType" ? "textTypes" : undefined,
        facetQuery: url.searchParams.get("facetQuery") ?? undefined,
        authorQuery: url.searchParams.get("authorQuery") ?? undefined,
        workQuery: url.searchParams.get("workQuery") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? "20")
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
    const status = isDatabaseConfigurationError(error) ? 503 : 500;
    return NextResponse.json(
      { error: isDatabaseConfigurationError(error) ? "database_not_configured" : "metadata_failed" },
      { status }
    );
  }
}
