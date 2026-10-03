import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";
import { HttpError } from "@/server/research/service";
import { errorMessage } from "@/server/util/errors";
import { createLogger } from "@/server/util/logger";

const log = createLogger("http");

export function jsonError(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

/**
 * State-changing requests must be same-origin JSON. Browsers can't send
 * cross-site `application/json` without a CORS preflight (which we never
 * grant), so together with SameSite cookies this blocks CSRF.
 */
function checkMutation(request: Request): string | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* malformed Origin header */
    }
    if (originHost !== host) return "Cross-origin request rejected";
  }
  const type = request.headers.get("content-type") ?? "";
  if (request.method !== "DELETE" && !type.includes("application/json")) return "Expected application/json";
  return null;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

type Handler<P> = (ctx: { request: Request; user: CurrentUser; params: P }) => Promise<Response>;

/** Wraps a route handler with auth, CSRF checks and uniform error responses. */
export function authedRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const rejected = checkMutation(request);
      if (rejected) return jsonError(403, rejected);
      const user = await getCurrentUser();
      if (!user) return jsonError(401, "Sign in required");
      return await handler({ request, user, params: await context.params });
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.message);
      if (err instanceof ZodError) return jsonError(400, err.issues[0]?.message ?? "Invalid request", err.issues);
      log.error("unhandled route error", { url: request.url, error: errorMessage(err) });
      return jsonError(500, "Something went wrong. Please try again.");
    }
  };
}
