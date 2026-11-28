import { Link, Navigate, Outlet, useLocation } from "react-router";
import type { RouteObject } from "react-router";
import { Button } from "../components/ui/button";
import { safeReturnPath } from "./return-path";
import { useSession } from "./session-provider";

function AppLayout() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header>
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-lg font-latin text-2xl font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-lg" />
          yoin
        </Link>
      </header>
      <main className="my-auto py-12">
        <Outlet />
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">ライブの予定を、仲間と。</h1>
      <p className="mb-6 text-[13px] text-muted-foreground">公演やチケットの予定を共有できます。</p>
      <Button asChild className="w-full"><Link to="/login">ログインへ</Link></Button>
    </>
  );
}

function Login({ invitation = false }: { invitation?: boolean }) {
  const { search } = useLocation();
  const session = useSession();
  if (session !== null && !invitation) {
    const destination = safeReturnPath(new URLSearchParams(search).get("returnTo"), window.location.origin);
    return <Navigate replace to={destination ?? "/"} />;
  }
  return (
    <section className="rounded-lg bg-card p-6">
      <h1 className="mb-2 text-2xl font-bold">{invitation ? "招待から参加" : "ログイン"}</h1>
      <p className="mb-6 text-[13px] text-muted-foreground">
        {invitation ? "招待からの参加機能は準備中です。" : "ログイン機能は準備中です。"}
      </p>
      <Button asChild variant="outline"><Link to="/">トップへ戻る</Link></Button>
    </section>
  );
}

function RequireSession() {
  const { pathname, search, hash } = useLocation();
  const session = useSession();
  if (session !== null) return <Outlet />;
  const returnTo = safeReturnPath(pathname + search + hash, window.location.origin);
  const loginSearch = returnTo === null ? "" : new URLSearchParams({ returnTo }).toString();
  return <Navigate replace to={{ pathname: "/login", search: loginSearch }} />;
}

function GroupEntry() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">グループ</h1>
      <p className="text-[13px] text-muted-foreground">グループの画面は準備中です。</p>
    </>
  );
}

function NotFound() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">ページが見つかりません</h1>
      <Button asChild variant="outline" className="mt-4"><Link to="/">トップへ戻る</Link></Button>
    </>
  );
}

export const appRoutes: RouteObject[] = [{
  element: <AppLayout />,
  children: [
    { index: true, element: <Welcome /> },
    { path: "login", element: <Login /> },
    { path: "join", element: <Login invitation /> },
    {
      path: "groups/:groupId",
      element: <RequireSession />,
      children: [
        { index: true, element: <GroupEntry /> },
        { path: "*", element: <NotFound /> },
      ],
    },
    { path: "*", element: <NotFound /> },
  ],
}];
