import { NextRequest, NextResponse } from "next/server";
import { hashedIp } from "./logger";

type RateLimitRoute = "search" | "metadata" | "passage" | "synthesize";
type RateLimitBucket = { count: number; resetAt: number };
type RateLimitStore = {
  get(key: string): RateLimitBucket | undefined;
  set(key: string, bucket: RateLimitBucket): void;
};

const buckets = new Map<string, RateLimitBucket>();
let store: RateLimitStore = buckets;

export function setRateLimitStoreForTests(nextStore: RateLimitStore) {
  store = nextStore;
}

export function resetRateLimitStoreForTests() {
  buckets.clear();
  store = buckets;
}

export function limitForRoute(route: RateLimitRoute): number {
  const envName = `RATE_LIMIT_${route.toUpperCase()}_PER_MINUTE`;
  const configured = Number(process.env[envName]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return route === "search" ? 60 : route === "metadata" ? 60 : route === "passage" ? 120 : 5;
}

export function rateLimit(request: NextRequest, route: RateLimitRoute): NextResponse | null {
  const now = Date.now();
  const key = `${route}:${hashedIp(request)}`;
  const bucket = store.get(key);
  const limit = limitForRoute(route);
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (bucket.count >= limit) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) } }
    );
  }
  bucket.count += 1;
  store.set(key, bucket);
  return null;
}
