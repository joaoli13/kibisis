import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

export function hashedIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "unknown";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export function logRequest(fields: {
  request: NextRequest;
  route: string;
  statusCode: number;
  latencyMs: number;
  queryLength?: number;
  passageId?: string;
  dataSource: string;
}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      route: fields.route,
      ip: hashedIp(fields.request),
      query_length: fields.queryLength,
      passage_id: fields.passageId,
      latency_ms: fields.latencyMs,
      status_code: fields.statusCode,
      data_source: fields.dataSource
    })
  );
}

