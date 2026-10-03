import "server-only";
import { headers } from "next/headers";
import { getAuth } from "./auth";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
}

/** Returns the signed-in user, or null. Works in server components and route handlers. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const auth = await getAuth();
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;
  const { user } = result;
  return { id: user.id, email: user.email, name: user.name, image: user.image ?? null };
}
