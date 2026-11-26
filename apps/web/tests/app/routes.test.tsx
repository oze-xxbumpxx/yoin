// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { safeReturnPath } from "../../src/app/return-path";
import { appRoutes } from "../../src/app/routes";
import { createSessionStore } from "../../src/app/session";
import { SessionProvider } from "../../src/app/session-provider";

afterEach(cleanup);
const origin = window.location.origin;

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const store = createSessionStore();
  render(<SessionProvider store={store}><RouterProvider router={router} /></SessionProvider>);
  return { router, store };
}

const testCredentials = () => ({ getAccessToken: () => "test-member", clear: () => {} });

describe("U07 routes and return paths", () => {
  it("navigates between the entry and sign-in, with a separate invitation entry", async () => {
    const { router } = renderApp("/");
    fireEvent.click(screen.getByRole("link", { name: "ログインへ" }));
    await screen.findByRole("heading", { name: "ログイン" });
    expect(router.state.location.pathname).toBe("/login");
    fireEvent.click(screen.getByRole("link", { name: "トップへ戻る" }));
    await screen.findByRole("heading", { name: "ライブの予定を、仲間と。" });
    await act(async () => { await router.navigate("/join?token=sample"); });
    await screen.findByRole("heading", { name: "招待から参加" });
    expect(router.state.location.search).toBe("?token=sample");
    await act(async () => { await router.navigate("/missing"); });
    await screen.findByRole("heading", { name: "ページが見つかりません" });
  });

  it("returns to the protected path with its query and fragment and regates it on logout", async () => {
    const destination = "/groups/shared?view=next#upcoming";
    const { router, store } = renderApp(destination);
    await screen.findByRole("heading", { name: "ログイン" });
    expect(router.state.location.pathname).toBe("/login");
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe(destination);
    act(() => { store.startSession("member", testCredentials); });
    await screen.findByRole("heading", { name: "グループ" });
    expect(router.state.location).toMatchObject({ pathname: "/groups/shared", search: "?view=next", hash: "#upcoming" });
    act(() => { store.stopSession(); });
    await screen.findByRole("heading", { name: "ログイン" });
    expect(screen.queryByRole("heading", { name: "グループ" })).toBeNull();
  });

  it("falls back to the entry page instead of following an external return URL", async () => {
    const { router, store } = renderApp("/login?returnTo=https%3A%2F%2Fexternal.example%2F");
    await screen.findByRole("heading", { name: "ログイン" });
    act(() => { store.startSession("member", testCredentials); });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await screen.findByRole("heading", { name: "ライブの予定を、仲間と。" });
  });

  it("preserves a nested notification destination through the login boundary", async () => {
    const destination = "/groups/shared/ticket-applications/application?from=notification#reminder";
    const { router, store } = renderApp(destination);
    await screen.findByRole("heading", { name: "ログイン" });
    expect(new URLSearchParams(router.state.location.search).get("returnTo")).toBe(destination);
    act(() => { store.startSession("member", testCredentials); });
    await screen.findByRole("heading", { name: "ページが見つかりません" });
    const { pathname, search, hash } = router.state.location;
    expect(pathname + search + hash).toBe(destination);
  });

  it.each([
    "/join?token=sample",
    "/groups/shared/ticket-applications/application?from=notification#reminder",
  ])("accepts app path %s", (path) => {
    expect(safeReturnPath(path, origin)).toBe(path);
  });

  it.each([
    null, "", "groups/shared", "https://external.example/", `${origin}/groups/shared`,
    "//external.example", "/\\external.example", "/%2Fexternal.example", "/groups/..//external.example",
  ])("rejects non-app or ambiguous path %s", (path) => {
    expect(safeReturnPath(path, origin)).toBeNull();
  });
});
