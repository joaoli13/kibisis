import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMetadataFacetsMock = vi.fn();
const getMetadataSummaryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  dataSource: () => "postgres",
  getMetadataFacets: getMetadataFacetsMock,
  getMetadataSummary: getMetadataSummaryMock,
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
    getMetadataSummaryMock.mockReset();
    getMetadataSummaryMock.mockResolvedValue({
      authors_count: 159,
      works_count: 1173,
      passages_count: 27536
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
    expect(payload.summary).toEqual({ authors_count: 159, works_count: 1173, passages_count: 27536 });
    expect(getMetadataFacetsMock).toHaveBeenCalledWith(
      { genre: ["tragedy", "history"] },
      {
        dashboard: true,
        scope: "corpus",
        facet: "authors",
        facetQuery: "plat",
        authorQuery: undefined,
        workQuery: undefined,
        limit: 20
      }
    );
    expect(getMetadataSummaryMock).toHaveBeenCalledWith({ genre: ["tragedy", "history"] });
  });

  it("passes author and work facet queries independently", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(
      "http://localhost/api/metadata?dashboard=true&authorQuery=aristotle&workQuery=ethics&author=author%3AgreekLit%3Atlg0086"
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(getMetadataFacetsMock).toHaveBeenCalledWith(
      { author: "author:greekLit:tlg0086" },
      {
        dashboard: true,
        scope: "compatible",
        facet: undefined,
        facetQuery: undefined,
        authorQuery: "aristotle",
        workQuery: "ethics",
        limit: 20
      }
    );
  });

  it("returns filtered and total summaries when requested", async () => {
    const { GET } = await import("./route");
    getMetadataSummaryMock
      .mockResolvedValueOnce({ authors_count: 3, works_count: 6, passages_count: 340 })
      .mockResolvedValueOnce({ authors_count: 159, works_count: 1173, passages_count: 27536 });
    const request = new NextRequest("http://localhost/api/metadata?summary=true&totalSummary=true&author=Homer");

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.summary).toEqual({ authors_count: 3, works_count: 6, passages_count: 340 });
    expect(payload.totalSummary).toEqual({ authors_count: 159, works_count: 1173, passages_count: 27536 });
    expect(getMetadataSummaryMock).toHaveBeenNthCalledWith(1, { author: "Homer" });
    expect(getMetadataSummaryMock).toHaveBeenNthCalledWith(2, {});
  });

  it("rejects overlong facet queries before aggregation work", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(`http://localhost/api/metadata?dashboard=true&authorQuery=${"a".repeat(101)}`);

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "input_too_long", field: "authorQuery", limit: 100 });
    expect(getMetadataFacetsMock).not.toHaveBeenCalled();
    expect(getMetadataSummaryMock).not.toHaveBeenCalled();
  });

  it("rejects invalid metadata limits before aggregation work", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("http://localhost/api/metadata?dashboard=true&limit=-1");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_limit", field: "limit" });
    expect(getMetadataFacetsMock).not.toHaveBeenCalled();
  });
});
