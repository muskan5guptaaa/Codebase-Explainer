import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, errorCode, errorMessage, GITHUB_URL } from "../api.js";
import { useAuth } from "../auth.jsx";
import RefPicker from "../components/RefPicker.jsx";
import RepoCard from "../components/RepoCard.jsx";

/** What to offer when GitHub says "not found": usually a private repo we can't see yet. */
function PrivateRepoHint({ returnTo }) {
  const { enabled, user, signIn } = useAuth();
  if (!enabled) return null;
  const button = (label) => (
    <button
      type="button"
      onClick={() => signIn({ privateAccess: true, returnTo })}
      className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-accent hover:text-accent"
    >
      {label}
    </button>
  );
  if (!user) {
    return (
      <div className="mt-2 text-sm text-slate-600">
        If it's a private repository, sign in with GitHub to analyse it.
        <br />
        {button("Sign in with GitHub")}
      </div>
    );
  }
  if (!user.privateAccess) {
    return (
      <div className="mt-2 text-sm text-slate-600">
        If it's a private repository, give Codebase Explainer access to your private repos.
        <br />
        {button("Enable private repos")}
      </div>
    );
  }
  return (
    <p className="mt-2 text-sm text-slate-600">
      Check the URL. If the repo belongs to an organization, the organization may need to approve this app (GitHub →
      Settings → Applications).
    </p>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const [url, setUrl] = useState(() => params.get("url") ?? "");
  const [ref, setRef] = useState(() => params.get("ref") ?? "");
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null); // { message, code }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null); // { message, code }
  const [authError] = useState(() => params.get("auth_error"));

  // The query string only carries state across the GitHub sign-in redirect; clear it once read.
  useEffect(() => {
    if (params.toString()) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmed = url.trim();
  const valid = GITHUB_URL.test(trimmed);
  // Where sign-in should come back to, with the form state restored.
  const returnTo = `/?${new URLSearchParams({ url: trimmed, ...(ref.trim() ? { ref: ref.trim() } : {}) })}`;

  // Fetch metadata as soon as the URL looks valid: fast feedback before any AI call.
  // Re-runs on sign-in changes, since a private repo only becomes visible after signing in.
  useEffect(() => {
    setMeta(null);
    setMetaError(null);
    if (!valid) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      api
        .get("/repo-meta", { params: { url: trimmed }, signal: controller.signal })
        .then((r) => setMeta(r.data))
        .catch((err) => {
          if (!controller.signal.aborted) setMetaError({ message: errorMessage(err), code: errorCode(err) });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [trimmed, valid, user?.id, user?.privateAccess]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post("/analyze", { url: trimmed, ref: ref.trim() || undefined });
      navigate(`/repo/${data.jobId}`);
    } catch (err) {
      setError({ message: errorMessage(err), code: errorCode(err) });
      setSubmitting(false);
    }
  }

  const notFound = metaError?.code === "not_found_or_private" || error?.code === "not_found_or_private";

  return (
    <div className="mx-auto max-w-2xl pt-10">
      <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        Understand any GitHub repo in a minute
      </h1>
      <p className="mt-3 text-slate-600">
        Paste a GitHub repo URL. You'll get a plain-English walkthrough: what the project does, how the pieces connect,
        which files to read first, and what's likely to confuse you.
      </p>

      {authError && (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {authError}
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setRef("");
            }}
            placeholder="https://github.com/owner/repo"
            aria-label="GitHub repository URL"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            autoFocus
          />
          <button
            type="submit"
            disabled={!valid || submitting || !meta}
            className="rounded-md bg-accent px-6 py-3 font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Explain"}
          </button>
        </div>
        {meta && <RefPicker key={meta.htmlUrl} repoUrl={meta.htmlUrl} value={ref} onChange={setRef} />}
      </form>

      {url && !valid && <p className="mt-2 text-sm text-slate-500">The URL must look like github.com/owner/repo</p>}
      {metaError && <p className="mt-3 text-sm text-red-600">{metaError.message}</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error.message}</p>}
      {notFound && <PrivateRepoHint returnTo={returnTo} />}
      {meta && (
        <div className="mt-6">
          <RepoCard meta={meta} />
          {meta.private && (
            <p className="mt-2 text-xs text-slate-500">
              Private repository: the analysis is visible only to you. Its source files are sent to the AI model to
              generate the walkthrough.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
