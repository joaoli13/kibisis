import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Passage, SemanticNode } from "./types";

let passagesCache: Passage[] | undefined;
let nodesCache: SemanticNode[] | undefined;
let authorsCache: unknown[] | undefined;
let clustersCache: unknown[] | undefined;

function readStaticJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "public", "data", filename), "utf8")) as T;
}

export function staticPassages(): Passage[] {
  passagesCache ??= readStaticJson<Passage[]>("passages.json").filter(
    (passage) => passage.license_status === "cc_compatible"
  );
  return passagesCache;
}

export function staticNodes(): SemanticNode[] {
  nodesCache ??= readStaticJson<SemanticNode[]>("nodes.json").filter(
    (node) => node.license_status === "cc_compatible"
  );
  return nodesCache;
}

export function staticAuthors(): unknown[] {
  authorsCache ??= readStaticJson<unknown[]>("authors.json");
  return authorsCache;
}

export function staticClusters(): unknown[] {
  clustersCache ??= readStaticJson<unknown[]>("clusters.json");
  return clustersCache;
}
