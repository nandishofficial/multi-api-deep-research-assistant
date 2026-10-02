import Link from "next/link";
import type { CurrentUser } from "@/server/auth/session";
import { SignOutButton } from "./auth-buttons";

export function AppHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-slate-900">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-900 text-xs font-bold text-white">DR</span>
          <span className="hidden sm:inline">Deep Research Assistant</span>
          <span className="sm:hidden">Deep Research</span>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-semibold">{user.name.slice(0, 1)}</span>
          )}
          <span className="hidden max-w-[12rem] truncate text-sm text-slate-600 md:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
