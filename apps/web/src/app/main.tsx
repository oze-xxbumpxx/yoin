import "../styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { appRoutes } from "./routes";
import { createSessionStore } from "./session";
import { SessionProvider } from "./session-provider";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing app root");

const router = createBrowserRouter(appRoutes);
const sessionStore = createSessionStore();

createRoot(root).render(
  <StrictMode>
    <SessionProvider store={sessionStore}>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);
