import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-slate-600">This research doesn&apos;t exist or belongs to another account.</p>
      <Link href="/" className="mt-6 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white">
        Back to my research
      </Link>
    </main>
  );
}
