import { useEffect, useMemo, useRef, useState } from "react";
import { api, knownPaths, readSse } from "../api.js";
import RepoMarkdown from "./RepoMarkdown.jsx";

/** Repo-specific questions from the analysis; older analyses fall back to ones built from its contents. */
function starterQuestions(a) {
  if (a.suggestedQuestions?.length) return a.suggestedQuestions;
  const qs = [];
  if (a.readingOrder?.[0]) qs.push(`Walk me through ${a.readingOrder[0].file}. What does it do and what calls it?`);
  for (const c of (a.confusionMap ?? []).slice(0, 2)) qs.push(`Can you explain more about "${c.issue}"?`);
  qs.push("Where would I start if I wanted to add a new feature?");
  return qs;
}

function Sources({ sources, fileUrl }) {
  if (!sources?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">Sources:</span>
      {sources.map((p) => (
        <a
          key={p}
          href={fileUrl(p)}
          target="_blank"
          rel="noreferrer"
          title={`Open ${p} on GitHub`}
          className="max-w-full truncate rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-teal-800 hover:border-accent"
        >
          {p}
        </a>
      ))}
    </div>
  );
}

function SuggestionChips({ questions, onPick, disabled }) {
  return (
    <div className="flex flex-wrap gap-2">
      {questions.map((q) => (
        <button
          key={q}
          type="button"
          disabled={disabled}
          onClick={() => onPick(q)}
          className="rounded-full border border-slate-200 px-3 py-1 text-left text-sm text-slate-600 hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

/** `resume`: load the signed-in user's previous conversation about this analysis. */
export default function ChatPanel({ jobId, analysis, fileUrl, resume }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(resume);
  const [error, setError] = useState("");
  const sessionId = useRef(null);
  const bottom = useRef(null);

  const known = useMemo(() => knownPaths(analysis), [analysis]);
  const suggestions = useMemo(() => starterQuestions(analysis), [analysis]);
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.content));
  const unasked = suggestions.filter((q) => !asked.has(q));

  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    setLoadingHistory(true);
    api
      .get(`/chat/${jobId}/session`)
      .then(({ data }) => {
        if (cancelled) return;
        sessionId.current = data.sessionId;
        setMessages(data.messages);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
    };
  }, [jobId, resume]);

  // Follow the reply while it streams (not on initial load, which would yank the page down).
  useEffect(() => {
    if (busy) bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  function newChat() {
    sessionId.current = null;
    setMessages([]);
    setError("");
  }

  async function send(text) {
    const message = text.trim();
    if (!message || busy || loadingHistory) return;
    setInput("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "", sources: [] }]);

    const updateReply = (fn) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ jobId, sessionId: sessionId.current, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      for await (const { event, data } of readSse(res)) {
        if (event === "session") sessionId.current = data.sessionId;
        else if (event === "text") updateReply((r) => ({ ...r, content: r.content + data.text }));
        else if (event === "sources") updateReply((r) => ({ ...r, sources: data.sources }));
        else if (event === "error") throw new Error(data.message);
      }
    } catch (err) {
      setError(err.message);
      // Remove the empty/partial reply and the question it belonged to.
      setMessages((m) => m.slice(0, -2));
      setInput(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 print:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-accent uppercase">Follow-up</div>
          <h2 className="mt-1 mb-3 text-lg font-semibold">Ask about this codebase</h2>
        </div>
        {messages.length > 0 && !busy && (
          <button type="button" onClick={newChat} className="text-sm font-medium text-slate-500 hover:text-accent">
            New chat
          </button>
        )}
      </div>

      {loadingHistory && <p className="mb-3 text-sm text-slate-400">Loading your conversation…</p>}

      {!loadingHistory && messages.length === 0 && (
        <div className="mb-3">
          <p className="mb-2 text-xs text-slate-500">Suggested questions</p>
          <SuggestionChips questions={suggestions} onPick={send} disabled={busy} />
        </div>
      )}

      <div className="space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm whitespace-pre-wrap text-white">{m.content}</div>
            ) : (
              <div className="max-w-full text-sm">
                {m.content ? (
                  <div className="prose-md">
                    <RepoMarkdown known={known} fileUrl={fileUrl}>
                      {m.content}
                    </RepoMarkdown>
                  </div>
                ) : (
                  <span className="animate-pulse text-slate-400">Thinking…</span>
                )}
                <Sources sources={m.sources} fileUrl={fileUrl} />
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {messages.length > 0 && !busy && unasked.length > 0 && (
        <div className="mt-4">
          <SuggestionChips questions={unasked.slice(0, 3)} onPick={send} disabled={busy} />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What does the auth middleware do?"
          aria-label="Your question"
          maxLength={4000}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          disabled={busy || loadingHistory}
        />
        <button
          type="submit"
          disabled={busy || loadingHistory || !input.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
