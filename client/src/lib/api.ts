// Fetch helpers. Every request is same-origin JSON (the server's CSRF guard
// wants Content-Type: application/json on anything that changes state).
import { QueryClient, type QueryFunction } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

/** A 401 anywhere means the session is gone: the auth query flips to "logged out". */
function onUnauthorized() {
  queryClient.setQueryData(["/api/auth/me"], null);
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await parse(res);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/auth/firebase-login")) onUnauthorized();
    const msg = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : res.statusText;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

const defaultQueryFn: QueryFunction = ({ queryKey }) => api("GET", queryKey.join("/").replace(/\/+/g, "/"));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});
