import { NextRequest, NextResponse } from "next/server";
import { dataSource, getMetadataFacets, isDatabaseConfigurationError } from "@/lib/db";
import { withProvenance } from "@/lib/provenance";
import type { SearchFilters } from "@/lib/types";

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

export async function GET(request: NextRequest) {
  try {
    const facets = await getMetadataFacets(readFilters(new URL(request.url)));
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
