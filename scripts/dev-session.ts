/**
 * LOCAL TESTING ONLY. Creates (or reuses) a user and prints a signed session
 * cookie, so the app can be exercised end to end without Google OAuth:
 *
 *   DATABASE_URL=postgres://... BETTER_AUTH_SECRET=... npx tsx --conditions=react-server scripts/dev-session.ts you@gmail.com
 *
 * It builds a separate Better Auth instance with the `test-utils` plugin; the
 * production auth config never includes it.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { testUtils } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb, runMigrations, schema } from "../src/server/db/client";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("dev-session is for local testing only");
  const email = process.argv[2] ?? "demo.user@gmail.com";
  await runMigrations();
  const db = await getDb();
  const auth = betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me-please",
    database: drizzleAdapter(db, { provider: "pg", schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification } }),
    plugins: [testUtils()],
  });
  const ctx = await auth.$context;
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  const user = existing ?? (await ctx.test.saveUser(ctx.test.createUser({ email, name: email.split("@")[0], emailVerified: true })));
  const { cookies } = await ctx.test.login({ userId: user.id });
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  console.log(cookie);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
