import { getAuth } from "@/server/auth/auth";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const auth = await getAuth();
  return auth.handler(request);
}

export { handle as GET, handle as POST };
