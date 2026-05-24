import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Provenance } from "./types";

type Metadata = {
  dataset_snapshot?: string | null;
};

let metadataCache: Metadata | undefined;

function corpusMetadata(): Metadata {
  if (metadataCache) {
    return metadataCache;
  }
  try {
    metadataCache = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "metadata.json"), "utf8")) as Metadata;
  } catch {
    metadataCache = {};
  }
  return metadataCache;
}

export function provenance(): Provenance {
  const metadata = corpusMetadata();
  return {
    source: "PerseusDL / Tufts University",
    source_url: "https://www.perseus.tufts.edu/",
    license: "CC BY-SA 4.0 where applicable",
    dataset_snapshot: metadata.dataset_snapshot ?? null,
    notice: "Only passages classified as cc_compatible are published."
  };
}

export function withProvenance<T extends object>(payload: T): T & { provenance: Provenance } {
  return {
    ...payload,
    provenance: provenance()
  };
}
