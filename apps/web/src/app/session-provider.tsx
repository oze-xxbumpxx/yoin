import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Session, SessionStore } from "./session";

const SessionContext = createContext<{ session: Session | null; store: SessionStore } | null>(null);

export function SessionProvider({ store, children }: { store: SessionStore; children: ReactNode }) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <SessionContext.Provider value={{ session, store }}>
      {session === null ? children : (
        <QueryClientProvider key={session.id} client={session.queryClient}>
          {children}
        </QueryClientProvider>
      )}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useSessionContext().session;
}

export function useSessionStore() {
  return useSessionContext().store;
}

function useSessionContext() {
  const context = useContext(SessionContext);
  if (context === null) throw new Error("Missing session provider");
  return context;
}
