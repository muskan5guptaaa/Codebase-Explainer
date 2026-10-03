import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // enabled: whether the server has GitHub sign-in configured at all.
  const [state, setState] = useState({ loading: true, enabled: false, user: null });

  useEffect(() => {
    api
      .get("/auth/me")
      .then((r) => setState({ loading: false, enabled: r.data.enabled, user: r.data.user }))
      .catch(() => setState({ loading: false, enabled: false, user: null }));
  }, []);

  /** Full-page redirect to GitHub. privateAccess asks for the "repo" scope as well. */
  const signIn = useCallback(({ privateAccess = false, returnTo } = {}) => {
    const params = new URLSearchParams({ returnTo: returnTo ?? window.location.pathname + window.location.search });
    if (privateAccess) params.set("private", "1");
    window.location.assign(`/api/auth/github?${params}`);
  }, []);

  const signOut = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    window.location.assign("/");
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
