import { describe, expect, it } from "vitest";
import {
  dataSource,
  englishTranslationSearchFilters,
  getMetadataFacets,
  getMetadataSummary,
  getNodes,
  getPassage,
  searchPassages,
  shouldPreferEnglishTranslations
} from "./db";

async function withoutDatabaseUrl(assertion: () => Promise<void>) {
  const databaseUrl = process.env.DATABASE_URL;
  const loadRootEnv = process.env.PERSEUS_LOAD_ROOT_ENV;
  delete process.env.DATABASE_URL;
  process.env.PERSEUS_LOAD_ROOT_ENV = "false";
  try {
    await assertion();
  } finally {
    if (databaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = databaseUrl;
    }
    if (loadRootEnv === undefined) {
      delete process.env.PERSEUS_LOAD_ROOT_ENV;
    } else {
      process.env.PERSEUS_LOAD_ROOT_ENV = loadRootEnv;
    }
  }
}

describe("postgres data source", () => {
  it("does not expose a static fallback data source", () => {
    expect(dataSource()).toBe("postgres");
  });

  it("prefers English translations only when language and text type are implicit", () => {
    expect(shouldPreferEnglishTranslations({})).toBe(true);
    expect(shouldPreferEnglishTranslations({ author: "Homer" })).toBe(true);
    expect(shouldPreferEnglishTranslations({ language: "grc" })).toBe(false);
    expect(shouldPreferEnglishTranslations({ language: ["grc", "lat"] })).toBe(false);
    expect(shouldPreferEnglishTranslations({ textType: "original" })).toBe(false);
    expect(englishTranslationSearchFilters({ author: "Homer" })).toEqual({
      author: "Homer",
      language: "en",
      textType: "translation"
    });
  });

  it("fails explicitly when DATABASE_URL is absent", async () => {
    await withoutDatabaseUrl(async () => {
      await expect(searchPassages("hospitality", {}, 5)).rejects.toThrow("DATABASE_URL is not configured");
      await expect(getNodes("author", {})).rejects.toThrow("DATABASE_URL is not configured");
      await expect(getMetadataFacets()).rejects.toThrow("DATABASE_URL is not configured");
      await expect(getMetadataSummary()).rejects.toThrow("DATABASE_URL is not configured");
      await expect(getPassage("passage:missing")).rejects.toThrow("DATABASE_URL is not configured");
    });
  });
});
