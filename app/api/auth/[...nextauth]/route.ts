import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { authConfigured } from "@/lib/server/config";
export const runtime = "nodejs";
async function handle(request: NextRequest) {
  if (!authConfigured())
    return Response.json(
      {
        error: {
          code: "auth_not_configured",
          message: "Login ainda não configurado.",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return request.method === "POST"
    ? handlers.POST(request)
    : handlers.GET(request);
}
export const GET = handle;
export const POST = handle;
