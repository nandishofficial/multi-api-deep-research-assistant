export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 45) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = diff;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [step, u] of units) {
    unit = u;
    if (Math.abs(value) < step) break;
    value = Math.round(value / step);
  }
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-value, unit);
}

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function elapsed(fromIso: string | null, toIso: string | null = null, now = Date.now()): string {
  if (!fromIso) return "—";
  const end = toIso ? new Date(toIso).getTime() : now;
  const sec = Math.max(0, Math.round((end - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** True when the title is just the (possibly truncated) query, so showing both would repeat it. */
export function titleRepeatsQuery(title: string, query: string): boolean {
  const t = title.replace(/…$/, "").trim();
  return t.length > 0 && query.trim().startsWith(t);
}

export function shortDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
