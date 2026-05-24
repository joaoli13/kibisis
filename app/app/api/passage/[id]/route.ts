import { NextRequest, NextResponse } from "next/server";
import { dataSource, getPassage, isDatabaseConfigurationError } from "@/lib/db";
import { logRequest } from "@/lib/logger";
import { withProvenance } from "@/lib/provenance";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, "passage");
  if (limited) {
    return limited;
  }
  const started = Date.now();
  const { id } = await context.params;
  let statusCode = 200;
  try {
    const passage = await getPassage(id);
    if (!passage) {
      statusCode = 404;
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(withProvenance({ passage }), {
      headers: { "x-perseus-data-source": dataSource() }
    });
  } catch (error) {
    statusCode = isDatabaseConfigurationError(error) ? 503 : 500;
    return NextResponse.json(
      { error: isDatabaseConfigurationError(error) ? "database_not_configured" : "passage_failed" },
      { status: statusCode }
    );
  } finally {
    logRequest({
      request,
      route: "/api/passage/[id]",
      statusCode,
      latencyMs: Date.now() - started,
      passageId: id,
      dataSource: dataSource()
    });
  }
}
