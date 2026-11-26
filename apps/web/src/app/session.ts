import { QueryClient } from "@tanstack/react-query";

export type SessionCredentials = {
  // A refresh must not save credentials after its session is aborted.
  getAccessToken: (signal: AbortSignal) => string | Promise<string>;
  // Removes only this session's local auth material, not its push subscription.
  clear: () => void;
};

export type Session = {
  readonly id: number;
  readonly queryClient: QueryClient;
  readonly signal: AbortSignal;
  readonly queryKey: (groupId: string | null, ...parts: readonly unknown[]) => readonly unknown[];
  readonly getAccessToken: SessionCredentials["getAccessToken"];
};

export function createSessionStore() {
  let nextId = 0;
  let active: { session: Session; close: () => void } | null = null;
  const listeners = new Set<() => void>();

  function publish() {
    for (const listener of listeners) listener();
  }

  function stopSession() {
    const previous = active;
    if (previous === null) return;
    active = null;
    try {
      previous.close();
    } finally {
      publish();
    }
  }

  return {
    getSnapshot: () => active?.session ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    startSession(userId: string, createCredentials: () => SessionCredentials) {
      stopSession();
      const credentials = createCredentials();
      const controller = new AbortController();
      const queryClient = new QueryClient();
      const session: Session = {
        id: ++nextId,
        queryClient,
        signal: controller.signal,
        queryKey: (groupId, ...parts) => ["user", userId, "group", groupId, ...parts],
        getAccessToken: async (signal) => {
          controller.signal.throwIfAborted();
          signal.throwIfAborted();
          const token = await credentials.getAccessToken(signal);
          controller.signal.throwIfAborted();
          signal.throwIfAborted();
          return token;
        },
      };
      active = {
        session,
        close: () => {
          controller.abort();
          try {
            queryClient.clear();
          } finally {
            credentials.clear();
          }
        },
      };
      publish();
      return session;
    },
    stopSession,
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
