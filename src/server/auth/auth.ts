import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb, schema } from "@/server/db/client";
import { appUrl, getEnv } from "@/server/env";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

async function createAuth() {
  const env = getEnv();
  const db = await getDb();
  const sendViaGmail = env.EMAIL_PROVIDER === "gmail";

  return betterAuth({
    appName: "Deep Research Assistant",
    baseURL: appUrl(),
    secret: env.BETTER_AUTH_SECRET ?? devSecret(env.NODE_ENV),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
        // Offline access gives us a refresh token so the background worker can
        // email the finished report long after the user closed the tab.
        accessType: "offline",
        prompt: "select_account consent",
        scope: sendViaGmail ? [GMAIL_SEND_SCOPE] : [],
      },
    },
    account: {
      // OAuth tokens (incl. the Gmail refresh token) are encrypted at rest.
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: appUrl().startsWith("https://"),
    },
    plugins: [nextCookies()],
  });
}

function devSecret(nodeEnv: string): string {
  if (nodeEnv === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production");
  }
  return "dev-only-insecure-secret-change-me-please";
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

const globalForAuth = globalThis as unknown as { __researchAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  if (!globalForAuth.__researchAuth) {
    globalForAuth.__researchAuth = createAuth().catch((err) => {
      globalForAuth.__researchAuth = undefined;
      throw err;
    });
  }
  return globalForAuth.__researchAuth;
}
