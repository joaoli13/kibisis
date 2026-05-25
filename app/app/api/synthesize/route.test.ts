import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPassagesMock = vi.fn();
const generateContentMock = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: generateContentMock
    })
  }))
}));

vi.mock("@/lib/db", () => ({
  dataSource: () => "postgres",
  getPassages: getPassagesMock,
  isDatabaseConfigurationError: () => false
}));

vi.mock("@/lib/logger", () => ({
  hashedIp: () => "test-ip",
  logRequest: vi.fn()
}));

vi.mock("@/lib/provenance", () => ({
  withProvenance: (payload: unknown) => payload
}));

describe("synthesize route input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
    getPassagesMock.mockResolvedValue([]);
  });

  it("rejects over-2000-character generation questions before loading passages", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "justice",
        question: "a".repeat(2001),
        passageIds: ["passage:one"]
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "input_too_long", field: "question", limit: 2000 });
    expect(getPassagesMock).not.toHaveBeenCalled();
  });

  it("rejects too many passage IDs instead of silently truncating context", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "justice",
        passageIds: Array.from({ length: 8 }, (_, index) => `passage:${index}`)
      })
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "too_many_passages", field: "passageIds", limit: 7 });
    expect(getPassagesMock).not.toHaveBeenCalled();
  });

  it("rejects oversized synthesis bodies before parsing", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/synthesize", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "20000"
      },
      body: "{}"
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "request_too_large", field: "body" });
    expect(getPassagesMock).not.toHaveBeenCalled();
  });

  it("retries one Gemini generation failure before returning an answer", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    getPassagesMock.mockResolvedValue([
      {
        id: "passage:one",
        cts_urn: "urn:cts:test",
        passage_ref: "1",
        text: "Justice is discussed here.",
        author_id: "author:one",
        work_id: "work:one",
        author: "Author",
        work: "Work",
        genre: "philosophy",
        period: "Classical",
        language: "eng",
        text_type: "translation",
        license_status: "cc_compatible",
        source_url: null
      }
    ]);
    generateContentMock
      .mockRejectedValueOnce(new Error("session warmup failed"))
      .mockResolvedValueOnce({
        response: {
          candidates: [{ finishReason: "STOP" }],
          text: () => "A cited answer. [1]"
        }
      });
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/synthesize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "justice",
        passageIds: ["passage:one"]
      })
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toBe("A cited answer. [1]");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
