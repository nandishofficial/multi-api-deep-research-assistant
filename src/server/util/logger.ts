import "server-only";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, scope: string, message: string, extra?: Record<string, unknown>) {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...extra });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, e?: Record<string, unknown>) => emit("debug", scope, m, e),
    info: (m: string, e?: Record<string, unknown>) => emit("info", scope, m, e),
    warn: (m: string, e?: Record<string, unknown>) => emit("warn", scope, m, e),
    error: (m: string, e?: Record<string, unknown>) => emit("error", scope, m, e),
  };
}

export type Logger = ReturnType<typeof createLogger>;
