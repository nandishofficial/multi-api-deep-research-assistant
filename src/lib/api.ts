"use client";

import type { ResearchDetail, ResearchListItem } from "./research-types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  list: () => request<{ items: ResearchListItem[] }>("/api/research"),
  get: (id: string) => request<{ research: ResearchDetail }>(`/api/research/${id}`),
  create: (query: string) => request<{ research: ResearchDetail }>("/api/research", { method: "POST", body: JSON.stringify({ query }) }),
  action: (id: string, action: string, body: unknown = {}) =>
    request<{ research: ResearchDetail }>(`/api/research/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }),
  remove: (id: string) => request<void>(`/api/research/${id}`, { method: "DELETE" }),
};
