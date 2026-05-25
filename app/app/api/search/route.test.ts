import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchPassagesMock = vi.fn();
const getNodesMock = vi.fn();
const getNodesForResultSetMock = vi.fn();
const getSampledNodesMock = vi.fn();

vi.mock("@/lib/db", () => ({
  dataSource: () => "postgres",
  getNodes: getNodesMock,
  getNodesForResultSet: getNodesForResultSetMock,
  getSampledNodes: getSampledNodesMock,
  isDatabaseConfigurationError: () => false,
  searchPassages: searchPassagesMock
}));

vi.mock("@/lib/logger", () => ({
  hashedIp: () => "test-ip",
  logRequest: vi.fn()
}));

vi.mock("@/lib/provenance", () => ({
  withProvenance: (payload: unknown) => payload
}));

describe("search route input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchPassagesMock.mockResolvedValue([]);
    getNodesMock.mockResolvedValue([]);
    getNodesForResultSetMock.mockResolvedValue([]);
    getSampledNodesMock.mockResolvedValue([]);
  });

  it("rejects over-2000-character retrieval text before search work", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest(`http://localhost/api/search?q=${"a".repeat(2001)}`);

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ error: "input_too_long", field: "q", limit: 2000 });
    expect(searchPassagesMock).not.toHaveBeenCalled();
    expect(getNodesMock).not.toHaveBeenCalled();
  });

  it("rejects invalid limits before database work", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("http://localhost/api/search?q=justice&limit=nan");

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_limit", field: "limit" });
    expect(searchPassagesMock).not.toHaveBeenCalled();
  });
});
