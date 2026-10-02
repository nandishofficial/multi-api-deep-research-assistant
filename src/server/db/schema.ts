import { relations } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ProviderName,
  ProviderRunMetadata,
  ProviderRunStatus,
  RefinementQuestion,
  ReportSummary,
  ResearchStatus,
  Source,
} from "@/lib/research-types";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ----------------------------------------------------------------------------
 * Better Auth tables (user / session / account / verification)
 * ------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/* ----------------------------------------------------------------------------
 * Research domain
 * ------------------------------------------------------------------------- */

export const researchSessions = pgTable(
  "research_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    query: text("query").notNull(),
    status: text("status").$type<ResearchStatus>().notNull(),
    /** Refinement questions produced by OpenAI, answered one by one by the user. */
    questions: jsonb("questions").$type<RefinementQuestion[]>().notNull().default([]),
    /** Research brief proposed by OpenAI after refinement (pending user approval). */
    refinedPrompt: text("refined_prompt"),
    /** Prompt approved by the user and sent to both providers. */
    finalPrompt: text("final_prompt"),
    promptApprovedAt: timestamp("prompt_approved_at", { withTimezone: true }),
    summary: jsonb("summary").$type<ReportSummary>(),
    error: text("error"),

    emailStatus: text("email_status").$type<"pending" | "sent" | "failed">(),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailError: text("email_error"),
    emailAttempts: integer("email_attempts").notNull().default(0),

    /** Consecutive failures of the current orchestration step (drives backoff). */
    stepAttempts: integer("step_attempts").notNull().default(0),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),

    researchStartedAt: timestamp("research_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("research_sessions_user_created_idx").on(t.userId, t.createdAt),
    index("research_sessions_due_idx").on(t.status, t.nextCheckAt),
  ],
);

export const providerRuns = pgTable(
  "provider_runs",
  {
    id: text("id").primaryKey(),
    researchId: text("research_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderName>().notNull(),
    status: text("status").$type<ProviderRunStatus>().notNull().default("pending"),
    model: text("model"),
    externalId: text("external_id"),
    /** How many times the remote job has been (re)started. */
    startAttempts: integer("start_attempts").notNull().default(0),
    /** Consecutive transient failures while starting/polling (drives backoff). */
    errorCount: integer("error_count").notNull().default(0),
    lastError: text("last_error"),
    progressNote: text("progress_note"),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    outputMarkdown: text("output_markdown"),
    sources: jsonb("sources").$type<Source[]>(),
    metadata: jsonb("metadata").$type<ProviderRunMetadata>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("provider_runs_research_provider_idx").on(t.researchId, t.provider)],
);

export const researchEvents = pgTable(
  "research_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    researchId: text("research_id")
      .notNull()
      .references(() => researchSessions.id, { onDelete: "cascade" }),
    level: text("level").$type<"info" | "warn" | "error">().notNull().default("info"),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("research_events_research_idx").on(t.researchId, t.id)],
);

export const researchSessionsRelations = relations(researchSessions, ({ many, one }) => ({
  runs: many(providerRuns),
  events: many(researchEvents),
  user: one(user, { fields: [researchSessions.userId], references: [user.id] }),
}));

export const providerRunsRelations = relations(providerRuns, ({ one }) => ({
  research: one(researchSessions, {
    fields: [providerRuns.researchId],
    references: [researchSessions.id],
  }),
}));

export const researchEventsRelations = relations(researchEvents, ({ one }) => ({
  research: one(researchSessions, {
    fields: [researchEvents.researchId],
    references: [researchSessions.id],
  }),
}));

export type ResearchSessionRow = typeof researchSessions.$inferSelect;
export type ProviderRunRow = typeof providerRuns.$inferSelect;
export type ResearchEventRow = typeof researchEvents.$inferSelect;
export type UserRow = typeof user.$inferSelect;
