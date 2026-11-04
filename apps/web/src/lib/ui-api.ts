export async function api<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string } & Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !json.error) return { ok: false, error: `HTTP ${res.status}` };
  return json;
}

export async function callTool<T = unknown>(tool: string, input: unknown) {
  const r = await api<{ data: T }>(`/api/v1/call/${tool}`, { method: "POST", body: JSON.stringify(input) });
  return { ...r, result: (r.data as { data?: T } | undefined)?.data as T | undefined };
}
