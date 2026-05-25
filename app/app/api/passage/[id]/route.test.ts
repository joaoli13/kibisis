import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPassageMock = vi.fn();

vi.mock("@/lib/db", () => ({
  dataSource: () => "postgres",
  getPassage: getPassageMock,
  isDatabaseConfigurationError: () => false
}));

vi.mock("@/lib/logger", () => ({
  hashedIp: () => "test-ip",
  logRequest: vi.fn()
}));

vi.mock("@/lib/provenance", () => ({
  withProvenance: (payload: unknown) => payload
}));

describe("passage route input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid passage IDs before database lookup", async () => {
    const { GET } = await import("./route");
    const request = new NextRequest("http://localhost/api/passage/bad%0Aid");

    const response = await GET(request, { params: Promise.resolve({ id: "bad\nid" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_id", field: "id" });
    expect(getPassageMock).not.toHaveBeenCalled();
  });
});
