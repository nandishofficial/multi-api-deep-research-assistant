import "server-only";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no"])
    .optional()
    .transform((v) => (v === undefined ? fallback : ["true", "1", "yes"].includes(v)));

const csv = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? fallback)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Database: a postgres:// URL, or `pglite://<dir>` / `pglite://memory` for zero-setup local runs.
  DATABASE_URL: z.string().min(1).default("pglite://./.data/pglite"),

  // Auth (Google OAuth via Better Auth)
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_DEEP_RESEARCH_MODEL: z.string().default("o3-deep-research"),
  OPENAI_DEEP_RESEARCH_FALLBACK_MODELS: csv("gpt-5.5"),
  OPENAI_REFINEMENT_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_SUMMARY_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_MAX_TOOL_CALLS: z.coerce.number().int().positive().optional(),

  // Gemini
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_DEEP_RESEARCH_AGENT: z.string().default("deep-research-preview-04-2026"),
  GEMINI_DEEP_RESEARCH_FALLBACK_AGENTS: csv("deep-research-pro-preview-12-2025"),

  // Use canned providers (no API keys needed) — for local demos and tests.
  RESEARCH_MOCK_PROVIDERS: bool(false),
  MOCK_PROVIDER_DURATION_MS: z.coerce.number().int().nonnegative().default(20_000),

  // Email delivery
  EMAIL_PROVIDER: z.enum(["gmail", "resend", "smtp", "console"]).default("gmail"),
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),

  // Orchestration
  WORKER_MODE: z.enum(["inline", "external", "off"]).default("inline"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5_000),
  PROVIDER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(15_000),
  PROVIDER_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(75),
  CRON_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed, validated environment. Lazily evaluated so `next build` works without secrets. */
export function getEnv(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** For tests: override env values without touching process.env. */
export function setEnvForTesting(overrides: Partial<Env>): void {
  cached = { ...EnvSchema.parse({}), ...overrides };
}

export function appUrl(): string {
  return (getEnv().BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
