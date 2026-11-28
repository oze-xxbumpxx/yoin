import { isCancelledError } from "@tanstack/react-query";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSessionApi } from "../../src/app/api";
import { createSessionStore } from "../../src/app/session";

const baseUrl = "https://api.example.test";
const credentials = (token: string) => ({ getAccessToken: () => token, clear: vi.fn() });

describe("U07 session isolation", () => {
  it("aborts the old Hono request and rejects a delayed response after the account changes", async () => {
    const oldRequest = Promise.withResolvers<AbortSignal>();
    const oldResponse = Promise.withResolvers<void>();
    const oldQueryResult = Promise.withResolvers<unknown>();
    const app = new Hono().get("/me", async (c) => {
      if (c.req.header("Authorization") === "Bearer first-member") {
        oldRequest.resolve(c.req.raw.signal);
        await oldResponse.promise;
        return c.json({ id: "first-member" });
      }
      if (c.req.header("Authorization") === "Bearer second-member") {
        return c.json({ id: "second-member" });
      }
      return c.json({ id: null });
    });
    const fakeFetch: typeof fetch = async (input, init) => app.request(new Request(input, init));
    const store = createSessionStore();
    const firstCredentials = credentials("first-member");
    const first = store.startSession("first-member", () => firstCredentials);
    const firstKey = first.queryKey("shared-group", "me");
    const secondKeyInFirstSession = first.queryKey("personal-group", "me");
    const firstApi = createSessionApi<typeof app>(baseUrl, first, fakeFetch);
    first.queryClient.setQueryData(firstKey, { id: "first-member-cached" });
    first.queryClient.setQueryData(secondKeyInFirstSession, { id: "first-member-personal" });
    expect(firstKey).toEqual(["user", "first-member", "group", "shared-group", "me"]);
    expect(secondKeyInFirstSession).not.toEqual(firstKey);

    const request = first.queryClient.fetchQuery({
      queryKey: firstKey,
      queryFn: async ({ signal }) => {
        try {
          const data = await (await firstApi.me.$get({}, { init: { signal } })).json();
          oldQueryResult.resolve(data);
          return data;
        } catch (error) {
          oldQueryResult.resolve(error);
          throw error;
        }
      },
    });
    const cancelled = request.catch((error: unknown) => error);
    const networkSignal = await oldRequest.promise;

    const second = store.startSession("second-member", () => {
      expect(firstCredentials.clear).toHaveBeenCalledOnce();
      return credentials("second-member");
    });
    expect(networkSignal.aborted).toBe(true);
    expect(first.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(second.queryClient).not.toBe(first.queryClient);
    expect(second.queryClient.getQueryCache().getAll()).toHaveLength(0);
    const secondKey = second.queryKey("shared-group", "me");
    expect(secondKey).toEqual(["user", "second-member", "group", "shared-group", "me"]);
    const secondApi = createSessionApi<typeof app>(baseUrl, second, fakeFetch);
    await expect(second.queryClient.fetchQuery({
      queryKey: secondKey,
      queryFn: async () => (await secondApi.me.$get()).json(),
    })).resolves.toEqual({ id: "second-member" });

    oldResponse.resolve();
    expect(isCancelledError(await cancelled)).toBe(true);
    await expect(oldQueryResult.promise).resolves.toMatchObject({ name: "AbortError" });
    expect(first.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(second.queryClient.getQueryData(firstKey)).toBeUndefined();
    expect(second.queryClient.getQueryData(secondKey)).toEqual({ id: "second-member" });
    await expect(firstApi.me.$get()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clears credentials, query and mutation caches and aborts untracked requests on logout", async () => {
    const store = createSessionStore();
    const auth = credentials("member");
    const session = store.startSession("member", () => auth);
    const app = new Hono().post("/write", (c) => c.json({ ok: true }));
    const sent = Promise.withResolvers<AbortSignal>();
    const reply = Promise.withResolvers<Response>();
    const fetcher: typeof fetch = async (_input, init) => {
      if (!init?.signal) throw new Error("Missing session signal");
      expect(init).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
      sent.resolve(init.signal);
      return reply.promise;
    };
    const api = createSessionApi<typeof app>(baseUrl, session, fetcher);
    const mutation = session.queryClient.getMutationCache().build(session.queryClient, {
      mutationFn: () => api.write.$post(),
    });
    session.queryClient.setQueryData(session.queryKey("group", "me"), { id: "member" });
    const rejected = expect(mutation.execute(null)).rejects.toMatchObject({ name: "AbortError" });
    const networkSignal = await sent.promise;

    store.stopSession();
    expect(networkSignal.aborted).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(auth.clear).toHaveBeenCalledOnce();
    expect(session.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(session.queryClient.getMutationCache().getAll()).toHaveLength(0);
    reply.resolve(Response.json({ ok: true }));
    await rejected;
  });

  it("does not send the request if logout occurs during credential refresh", async () => {
    const store = createSessionStore();
    const refresh = Promise.withResolvers<string>();
    const refreshStarted = Promise.withResolvers<AbortSignal>();
    const session = store.startSession("member", () => ({
      getAccessToken: (signal) => {
        refreshStarted.resolve(signal);
        return refresh.promise;
      },
      clear: vi.fn(),
    }));
    const app = new Hono().get("/me", (c) => c.json({ id: "member" }));
    const fetcher = vi.fn<typeof fetch>();
    const api = createSessionApi<typeof app>(baseUrl, session, fetcher);
    const rejected = expect(api.me.$get()).rejects.toMatchObject({ name: "AbortError" });
    const signal = await refreshStarted.promise;
    store.stopSession();
    expect(signal.aborted).toBe(true);
    refresh.resolve("member");
    await rejected;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("starts separate contexts signed out and never shares their clients", () => {
    const safari = createSessionStore();
    const pwa = createSessionStore();
    const first = safari.startSession("member", () => credentials("safari"));
    expect(pwa.getSnapshot()).toBeNull();
    const second = pwa.startSession("member", () => credentials("pwa"));
    safari.stopSession();
    expect(pwa.getSnapshot()).toBe(second);
    expect(second.queryClient).not.toBe(first.queryClient);
    expect(second.signal.aborted).toBe(false);
  });
});
