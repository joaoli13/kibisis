import { describe, expect, it } from "vitest";
import {
  countCodePoints,
  FREE_TEXT_MAX_CODE_POINTS,
  parseBoundedInteger,
  validateFreeText,
  validateId,
  validateSearchFilters
} from "./input-limits";

describe("input limit helpers", () => {
  it("counts Unicode code points consistently", () => {
    expect(countCodePoints("abc")).toBe(3);
    expect(countCodePoints("a🙂b")).toBe(3);
  });

  it("accepts free text at the 2000 code point boundary and rejects beyond it", () => {
    expect(validateFreeText("a".repeat(FREE_TEXT_MAX_CODE_POINTS), "q")).toBeNull();
    expect(validateFreeText(`${"a".repeat(FREE_TEXT_MAX_CODE_POINTS)}🙂`, "q")).toMatchObject({
      error: "input_too_long",
      field: "q",
      limit: FREE_TEXT_MAX_CODE_POINTS,
      status: 400
    });
  });

  it("rejects invalid numeric limits and clamps valid high limits", () => {
    expect(parseBoundedInteger("abc", "limit", 20, 100)).toMatchObject({
      value: 20,
      error: { error: "invalid_limit" }
    });
    expect(parseBoundedInteger("500", "limit", 20, 100)).toEqual({ value: 100, error: null });
  });

  it("rejects empty, long, or control-character IDs", () => {
    expect(validateId("passage:abc123", "id")).toBeNull();
    expect(validateId("", "id")).toMatchObject({ error: "invalid_id" });
    expect(validateId(`passage:${"\n"}`, "id")).toMatchObject({ error: "invalid_id" });
  });

  it("bounds filter fan-out before query planning", () => {
    expect(validateSearchFilters({ genre: Array.from({ length: 21 }, (_, index) => `g${index}`) })).toMatchObject({
      error: "too_many_filter_values",
      field: "genre"
    });
  });
});
