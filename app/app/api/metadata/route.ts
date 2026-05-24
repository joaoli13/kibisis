import { NextRequest, NextResponse } from "next/server";
import { dataSource, getMetadataFacets, isDatabaseConfigurationError } from "@/lib/db";
import { readFiltersFromSearchParams } from "@/lib/filters";
import { withProvenance } from "@/lib/provenance";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const facet = url.searchParams.get("facet") ?? undefined;
    const facets = await getMetadataFacets(readFiltersFromSearchParams(url.searchParams), {
      dashboard: url.searchParams.get("dashboard") === "true",
      scope: url.searchParams.get("scope") === "corpus" ? "corpus" : "compatible",
      facet: facet === "author" ? "authors" : facet === "work" ? "works" : facet === "genre" ? "genres" : facet === "period" ? "periods" : facet === "language" ? "languages" : facet === "textType" ? "textTypes" : undefined,
      facetQuery: url.searchParams.get("facetQuery") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? "20")
    });
    return NextResponse.json(withProvenance({ facets }), {
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
