import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, timeAgo } from "../api.js";
import { useAuth } from "../auth.jsx";

function HistoryItem({ item, onRemove }) {
  const [removing, setRemoving] = useState(false);

  async function remove() {
    const warning = item.private
      ? "Remove this private analysis? It and your chats about it will be deleted."
      : "Remove this analysis from My analyses? Your chats about it will be deleted.";
    if (!window.confirm(warning)) return;
    setRemoving(true);
    try {
      await onRemove(item);
    } catch (err) {
      setRemoving(false);
      window.alert(`Couldn't remove it: ${errorMessage(err)}`);
    }
  }

  return (
    <li className={`rounded-lg border border-slate-200 bg-white p-4 transition ${removing ? "opacity-50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <Link to={`/repo/${item.jobId}`} className="truncate font-semibold text-slate-900 hover:text-accent">
            {item.fullName}
          </Link>
          {item.private && (
            <span className="shrink-0 rounded border border-slate-300 px-1.5 text-[11px] font-medium text-slate-600">Private</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {item.language && <span>{item.language}</span>}
          {item.ref && (
            <span className="max-w-48 truncate font-mono" title={item.ref}>
              {item.ref}
            </span>
          )}
          {item.commitSha && <span className="font-mono">@{item.commitSha.slice(0, 7)}</span>}
        </div>
      </div>
      {(item.purpose || item.description) && <p className="mt-1 text-sm text-slate-600">{item.purpose || item.description}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span title={new Date(item.lastOpenedAt).toLocaleString()}>Opened {timeAgo(item.lastOpenedAt)}</span>
        <span title={new Date(item.createdAt).toLocaleString()}>Saved {timeAgo(item.createdAt)}</span>
        <span className="ml-auto flex gap-4">
          <Link to={`/repo/${item.jobId}`} className="font-medium text-accent hover:underline">
            Open
          </Link>
          <button onClick={remove} disabled={removing} className="font-medium text-slate-500 hover:text-red-600">
            Remove
          </button>
        </span>
      </div>
    </li>
  );
}

export default function HistoryPage() {
  const { loading, enabled, user, signIn } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | more | error
  const [error, setError] = useState("");

  const load = useCallback(async (query, after, signal) => {
    const { data } = await api.get("/history", { params: { q: query || undefined, cursor: after || undefined }, signal });
    return data;
  }, []);

  // First page; debounced while typing a search.
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const t = setTimeout(
      () => {
        setStatus("loading");
        load(q.trim(), null, controller.signal)
          .then((data) => {
            setItems(data.items);
            setCursor(data.nextCursor);
            setStatus("ready");
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            setError(errorMessage(err));
            setStatus("error");
          });
      },
      q ? 300 : 0,
    );
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, user, load]);

  async function loadMore() {
    setStatus("more");
    try {
      const data = await load(q.trim(), cursor);
      setItems((prev) => [...prev, ...data.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(data.nextCursor);
      setStatus("ready");
    } catch (err) {
      setError(errorMessage(err));
      setStatus("error");
    }
  }

  async function remove(item) {
    await api.delete(`/history/${item.id}`);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  if (loading) return <p className="text-slate-500">Loading…</p>;

  if (!enabled) {
    return (
      <div className="mx-auto max-w-2xl pt-10 text-slate-600">
        <h1 className="text-2xl font-bold text-slate-900">My analyses</h1>
        <p className="mt-3">GitHub sign-in isn't configured on this server, so analyses can't be saved.</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl pt-10">
        <h1 className="text-2xl font-bold">My analyses</h1>
        <p className="mt-3 text-slate-600">
          Sign in with GitHub to keep the repos you analyse, along with your follow-up chats, for as long as you need them.
        </p>
        <button
          onClick={() => signIn({ returnTo: "/history" })}
          className="mt-5 rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:bg-teal-800"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My analyses</h1>
          <p className="mt-1 text-sm text-slate-600">Saved analyses and their chats are kept until you remove them.</p>
        </div>
        <Link to="/" className="text-sm font-medium text-accent hover:underline">
          + Analyse a repo
        </Link>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by repo, branch or description"
        aria-label="Search my analyses"
        className="mt-6 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

      {status === "error" && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {status === "loading" && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {status !== "loading" && items.length === 0 && status !== "error" && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {q.trim() ? (
            <>No analyses match "{q.trim()}".</>
          ) : (
            <>
              Nothing here yet. Repos you analyse while signed in are saved automatically.{" "}
              <Link to="/" className="font-medium text-accent hover:underline">
                Analyse one now
              </Link>
            </>
          )}
        </div>
      )}

      {status !== "loading" && items.length > 0 && (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <HistoryItem key={item.id} item={item} onRemove={remove} />
          ))}
        </ul>
      )}

      {cursor && status !== "loading" && (
        <button
          onClick={loadMore}
          disabled={status === "more"}
          className="mt-4 w-full rounded-md border border-slate-300 bg-white py-2 text-sm font-medium text-slate-700 hover:border-accent disabled:opacity-50"
        >
          {status === "more" ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
