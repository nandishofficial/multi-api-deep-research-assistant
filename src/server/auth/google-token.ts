import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { GMAIL_SEND_SCOPE, getAuth } from "./auth";

export class GoogleAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthorizationError";
  }
}

/**
 * Returns a valid Google access token for the user (refreshing it through
 * Better Auth when expired). Used by the background worker, so it works
 * without a request/session context.
 */
export async function getGoogleAccessToken(
  userId: string,
  requiredScope: string = GMAIL_SEND_SCOPE,
): Promise<string> {
  const db = await getDb();
  const [acct] = await db
    .select({ id: schema.account.id, scope: schema.account.scope })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "google")))
    .limit(1);

  if (!acct) throw new GoogleAuthorizationError("No linked Google account for this user");

  const scopes = (acct.scope ?? "").split(/[\s,]+/);
  if (!scopes.includes(requiredScope)) {
    throw new GoogleAuthorizationError(
      `Google account was not granted ${requiredScope}. Sign out and sign in again to grant Gmail send permission.`,
    );
  }

  const auth = await getAuth();
  const token = await auth.api.getAccessToken({ body: { accountId: acct.id, userId } });
  if (!token?.accessToken) throw new GoogleAuthorizationError("Google did not return an access token");
  return token.accessToken;
}
