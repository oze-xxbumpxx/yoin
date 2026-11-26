import type { Hono } from "hono";
import { hc } from "hono/client";
import type { Session } from "./session";

export function createSessionApi<AppType extends Hono>(
  baseUrl: string,
  session: Session,
  fetcher: typeof fetch = fetch,
) {
  const base = new URL(baseUrl);
  if ((base.protocol !== "https:" && base.protocol !== "http:") || base.username || base.password) {
    throw new TypeError("Invalid API base URL");
  }
  return hc<AppType>(base.href, {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== base.origin) {
        throw new TypeError("Invalid API request origin");
      }
      const signal = AbortSignal.any([session.signal, request.signal]);
      signal.throwIfAborted();
      const token = await session.getAccessToken(signal);
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${token}`);
      const response = await fetcher(request, {
        headers,
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      signal.throwIfAborted();
      return response;
    },
  });
}
