import { describe, expect, it } from "vitest";
import {
  appendFiltersToParams,
  normalizeSearchFilters,
  readFiltersFromSearchParams,
  toggleFilterValue,
  valuesForFilter
} from "./filters";

describe("multi-value search filters", () => {
  it("normalizes blank, duplicate, single, and multi-value fields", () => {
    expect(normalizeSearchFilters({ genre: [" tragedy ", "history", "tragedy"], author: "  " })).toEqual({
      genre: ["tragedy", "history"]
    });
    expect(normalizeSearchFilters({ period: ["classical"] })).toEqual({ period: "classical" });
  });

  it("toggles values within one dimension without affecting other dimensions", () => {
    const filters = toggleFilterValue({ period: "classical" }, "genre", "tragedy");
    expect(filters).toEqual({ period: "classical", genre: "tragedy" });
    expect(toggleFilterValue(filters, "genre", "history")).toEqual({
      period: "classical",
      genre: ["tragedy", "history"]
    });
  });

  it("serializes and reads repeated query parameters", () => {
    const params = new URLSearchParams();
    appendFiltersToParams(params, { genre: ["tragedy", "history"], period: "classical" });

    expect(params.getAll("genre")).toEqual(["tragedy", "history"]);
    expect(readFiltersFromSearchParams(params)).toEqual({
      genre: ["tragedy", "history"],
      period: "classical"
    });
  });

  it("exposes array values consistently", () => {
    expect(valuesForFilter("Homer")).toEqual(["Homer"]);
    expect(valuesForFilter(["Homer", "Plato"])).toEqual(["Homer", "Plato"]);
    expect(valuesForFilter(undefined)).toEqual([]);
  });
});
