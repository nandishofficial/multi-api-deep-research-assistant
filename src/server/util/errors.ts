/**
 * Error classification shared by providers, email transports and the
 * orchestrator. Transient errors are retried with backoff; permanent ones
 * fail the step immediately.
 */

export type ErrorKind = "transient" | "permanent" | "model_unavailable";

export class ClassifiedError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  constructor(kind: ErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "ClassifiedError";
    this.kind = kind;
    this.status = options?.status;
  }
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  if (e.response && typeof e.response.status === "number") return e.response.status;
  return undefined;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Heuristic: the requested model / agent does not exist, is retired, or is not enabled for this key. */
export function looksLikeModelUnavailable(status: number | undefined, message: string): boolean {
  const m = message.toLowerCase();
  if (status === 404 && /model|agent/.test(m)) return true;
  return (
    /model_not_found|does not exist|not found|deprecated|decommissioned|no longer (available|supported)|shut ?down|retired|not supported|do(es)? not have access|unknown (model|agent)|invalid (model|agent)/.test(
      m,
    ) &&
    /model|agent/.test(m) &&
    (status === undefined || status === 400 || status === 403 || status === 404)
  );
}

export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ClassifiedError) return err;
  const status = statusOf(err);
  const message = errorMessage(err);
  const code = (err as { code?: unknown } | null)?.code;
  const causeCode = (err as { cause?: { code?: unknown } } | null)?.cause?.code;

  if (looksLikeModelUnavailable(status, message)) {
    return new ClassifiedError("model_unavailable", message, { status, cause: err });
  }
  if (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    (typeof code === "string" && TRANSIENT_CODES.has(code)) ||
    (typeof causeCode === "string" && TRANSIENT_CODES.has(causeCode)) ||
    /timeout|timed out|rate limit|overloaded|temporarily|unavailable|fetch failed|socket hang up|network/i.test(message)
  ) {
    return new ClassifiedError("transient", message, { status, cause: err });
  }
  return new ClassifiedError("permanent", message, { status, cause: err });
}

/** Exponential backoff with full jitter, in milliseconds. */
export function backoffMs(attempt: number, baseMs = 5_000, maxMs = 5 * 60_000, random = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Retry an async operation in-process for short, latency-sensitive calls. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; baseMs?: number; maxMs?: number; onRetry?: (err: ClassifiedError, attempt: number) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let lastErr: ClassifiedError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = classifyError(err);
      if (lastErr.kind !== "transient" || attempt === attempts) throw lastErr;
      opts.onRetry?.(lastErr, attempt);
      await new Promise((r) => setTimeout(r, backoffMs(attempt, opts.baseMs ?? 1_000, opts.maxMs ?? 10_000)));
    }
  }
  throw lastErr ?? new Error("withRetry: unreachable");
}
