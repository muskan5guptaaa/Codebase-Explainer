import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Menu, { MenuItem } from "./components/Menu.jsx";

function UserMenu() {
  const { loading, enabled, user, signIn, signOut } = useAuth();
  if (loading || !enabled) return null;

  if (!user) {
    return (
      <button
        onClick={() => signIn()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-accent hover:text-accent"
      >
        Sign in with GitHub
      </button>
    );
  }

  return (
    <Menu
      ariaLabel="Account"
      buttonClassName="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 text-sm text-slate-700 hover:bg-slate-100"
      label={
        <>
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full" />
          ) : (
            <span className="h-7 w-7 rounded-full bg-slate-200" />
          )}
          <span className="hidden max-w-32 truncate sm:inline">{user.login}</span>
        </>
      }
    >
      <div className="border-b border-slate-100 px-3 pt-1 pb-2 text-xs text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user.login}</span>
        <br />
        Private repos: {user.privateAccess ? "enabled" : "not enabled"}
      </div>
      {!user.privateAccess && (
        <MenuItem onClick={() => signIn({ privateAccess: true })} hint="Asks GitHub for access to your private repos">
          Enable private repos
        </MenuItem>
      )}
      <MenuItem onClick={signOut}>Sign out</MenuItem>
    </Menu>
  );
}

export default function App() {
  const { user } = useAuth();
  const onHome = useLocation().pathname === "/";
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5">
          <Link to="/" className="flex items-center gap-2 font-semibold text-accent">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Codebase Explainer
          </Link>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            {!onHome && (
              <Link
                to="/"
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white transition hover:bg-teal-800"
              >
                + New analysis
              </Link>
            )}
            {user && (
              <NavLink
                to="/history"
                className={({ isActive }) => (isActive ? "font-medium text-accent" : "text-slate-600 hover:text-accent")}
              >
                My analyses
              </NavLink>
            )}
            <UserMenu />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 print:max-w-none print:p-0">
        <Outlet />
      </main>
    </div>
  );
}
