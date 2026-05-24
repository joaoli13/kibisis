import { describe, expect, it } from "vitest";
import { hasMetadataScope, hasPassageNodeScope, hasTextSearch } from "./search-behavior";

describe("search behavior", () => {
  it("uses only non-empty text queries to populate the result set", () => {
    expect(hasTextSearch("hospitality")).toBe(true);
    expect(hasTextSearch("  ")).toBe(false);
  });

  it("treats metadata filters as scope without making them a passage search", () => {
    expect(hasMetadataScope({ genre: "biography" })).toBe(true);
    expect(hasTextSearch("")).toBe(false);
  });

  it("requires query, author, work, pagination, or sampled overview for passage nodes", () => {
    expect(hasPassageNodeScope("", {})).toBe(false);
    expect(hasPassageNodeScope("", { genre: "philosophy" })).toBe(false);
    expect(hasPassageNodeScope("virtue", {})).toBe(true);
    expect(hasPassageNodeScope("", { author: "Plato" })).toBe(true);
    expect(hasPassageNodeScope("", { work: "Republic" })).toBe(true);
    expect(hasPassageNodeScope("", {}, { page: "1" })).toBe(true);
    expect(hasPassageNodeScope("", {}, { overview: "sample" })).toBe(true);
  });
});
