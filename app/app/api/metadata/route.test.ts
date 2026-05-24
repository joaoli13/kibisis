import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMetadataFacetsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  dataSource: () => "postgres",
  getMetadataFacets: getMetadataFacetsMock,
  isDatabaseConfigurationError: () => false
}));

vi.mock("@/lib/provenance", () => ({
  withProvenance: (payload: unknown) => payload
}));

describe("metadata route dashboard facets", () => {
  beforeEach(() => {
    getMetadataFacetsMock.mockReset();
    getMetadataFacetsMock.mockResolvedValue({
      authors: [],
      works: [],
      genres: [{ id: "tragedy", label: "tragedy", count: 2, selected: true, compatible: true }],
      periods: [],
      languages: [],
      textTypes: []
    });
  });

  it("normalizes repeated filters and passes dashboard options", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      "http://localhost/api/metadata?dashboard=true&scope=corpus&genre=tragedy&genre=history&facet=author&facetQuery=plat&limit=20"
    );

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.facets.genres[0]).toMatchObject({ id: "tragedy", selected: true, compatible: true });
    expect(getMetadataFacetsMock).toHaveBeenCalledWith(
      { genre: ["tragedy", "history"] },
      { dashboard: true, scope: "corpus", facet: "authors", facetQuery: "plat", limit: 20 }
    );
  });
});
