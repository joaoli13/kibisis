import { NextRequest, NextResponse } from "next/server";
import { hashedIp } from "./logger";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function limitForRoute(route: "search" | "passage" | "synthesize"): number {
  const envName = `RATE_LIMIT_${route.toUpperCase()}_PER_MINUTE`;
  const configured = Number(process.env[envName]);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return route === "search" ? 60 : route === "passage" ? 120 : 10;
}

export function rateLimit(request: NextRequest, route: "search" | "passage" | "synthesize"): NextResponse | null {
  const now = Date.now();
  const key = `${route}:${hashedIp(request)}`;
  const bucket = buckets.get(key);
  const limit = limitForRoute(route);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }
  if (bucket.count >= limit) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)) } }
    );
  }
  bucket.count += 1;
  return null;
}

