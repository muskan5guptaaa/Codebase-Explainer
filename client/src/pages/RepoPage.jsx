import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import AnalysisView from "../components/AnalysisView.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import ProgressSteps from "../components/ProgressSteps.jsx";
import RepoCard from "../components/RepoCard.jsx";

const ALL_DONE = { 1: "done", 2: "done", 3: "done", 4: "done", 5: "done" };

// Maps each step's output onto the Analysis shape so sections render as they arrive.
function mergeStep(prev, step, data) {
  switch (step) {
    case 1:
      return {
        ...prev,
        overview: data.overview,
        classification: {
          projectType: data.projectType,
          primaryLanguage: data.primaryLanguage,
          framework: data.framework,
          purpose: data.purpose,
        },
      };
    default:
      return { ...prev, ...data };
  }
}

function SaveButton({ jobId, saved, onSaved }) {
  const { enabled, user, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!enabled) return null;
  const cls = "text-sm font-medium text-accent hover:underline disabled:opacity-50";

  if (!user) {
    return (
      <button onClick={() => signIn()} className={cls}>
        Sign in to save this analysis
      </button>
    );
  }
  if (saved) {
    return (
      <Link to="/history" className="text-sm text-slate-500 hover:text-accent">
        ✓ Saved in My analyses
      </Link>
    );
  }
  return (
    <span>
      <button
        disabled={busy}
        className={cls}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api.post("/history", { jobId });
            onSaved();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save to My analyses
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export default function RepoPage() {
  const { jobId } = useParams();
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [job, setJob] = useState(null);
  const [meta, setMeta] = useState(null);
  const [analysis, setAnalysis] = useState({});
  const [steps, setSteps] = useState(undefined);
  const [status, setStatus] = useState({});
  const [batch, setBatch] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | running | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    let source;
    let cancelled = false;

    async function loadFinal() {
      const { data } = await api.get(`/analyze/${jobId}`);
      if (cancelled) return;
      if (!data.analysis) throw new Error("This analysis has expired. Run it again from the home page.");
      setJob(data.job);
      setSaved(data.saved);
      setAnalysis(data.analysis);
      setMeta(data.analysis.repoMeta);
      setStatus(ALL_DONE);
      setPhase("done");
    }

    async function init() {
      try {
        const { data } = await api.get(`/analyze/${jobId}`);
        if (cancelled) return;
        setJob(data.job);
        if (data.analysis) return await loadFinal();
        if (data.job.status === "done") throw new Error("This analysis has expired. Run it again from the home page.");
        if (data.job.status === "error") {
          setError(data.job.error);
          setPhase("error");
          return;
        }

        setPhase("running");
        api.get("/repo-meta", { params: { url: data.job.repoUrl } }).then((r) => !cancelled && setMeta(r.data)).catch(() => {});

        source = new EventSource(`/api/analyze/${jobId}/stream`);
        source.addEventListener("steps", (e) => setSteps(JSON.parse(e.data)));
        source.addEventListener("step_start", (e) => {
          const { step } = JSON.parse(e.data);
          setStatus((s) => ({ ...s, [step]: "running" }));
        });
        source.addEventListener("step_progress", (e) => setBatch(JSON.parse(e.data)));
        source.addEventListener("step_complete", (e) => {
          const { step, data: stepData } = JSON.parse(e.data);
          setStatus((s) => ({ ...s, [step]: "done" }));
          setAnalysis((a) => mergeStep(a, step, stepData));
        });
        source.addEventListener("done", () => {
          source.close();
          loadFinal().catch((err) => {
            setError(errorMessage(err));
            setPhase("error");
          });
        });
        source.addEventListener("error", (e) => {
          // Server-sent "error" events carry data; a bare error is a dropped connection,
          // which EventSource retries on its own (the server replays all events).
          if (!e.data) return;
          source.close();
          setError(JSON.parse(e.data).message);
          setPhase("error");
        });
      } catch (err) {
        if (cancelled) return;
        setError(errorMessage(err));
        setPhase("error");
      }
    }

    // Re-runs when the signed-in user changes: private analyses only load for their owner.
    if (!auth.loading) init();
    return () => {
      cancelled = true;
      source?.close();
    };
  }, [jobId, auth.loading, auth.user?.id]);

  const sha = analysis?.commitSha ?? job?.commitSha;
  const base = meta?.htmlUrl ?? job?.repoUrl;
  const fileUrl = useCallback(
    (path) => `${base}/blob/${sha ?? "HEAD"}/${path.split("/").map(encodeURIComponent).join("/")}`,
    [base, sha],
  );

  if (phase === "loading") return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-5">
      {meta && <RepoCard meta={{ ...meta, private: meta.private ?? job?.private }} sha={sha} refName={job?.ref} />}

      {phase === "done" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
          <ExportMenu jobId={jobId} />
          <SaveButton jobId={jobId} saved={saved} onSaved={() => setSaved(true)} />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="text-sm font-medium text-accent hover:underline"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          {job?.private && <span className="text-xs text-slate-500">Private: only you can open this link.</span>}
        </div>
      )}

      {phase === "running" && <ProgressSteps steps={steps} status={status} batch={batch} />}
      {phase === "done" && job?.cached && (
        <p className="text-xs text-slate-500 print:hidden">Loaded from cache: this commit was already analysed.</p>
      )}

      {phase === "error" && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Analysis failed:</strong> {error}{" "}
          <Link to="/" className="font-medium underline">
            Try another repo
          </Link>
        </div>
      )}

      {phase !== "error" && <AnalysisView a={analysis} fileUrl={fileUrl} running={phase === "running"} />}

      {phase === "done" && <ChatPanel jobId={jobId} analysis={analysis} fileUrl={fileUrl} resume={Boolean(auth.user)} />}
    </div>
  );
}
