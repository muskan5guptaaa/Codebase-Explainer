import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { knownPaths } from "../api.js";
import RepoMarkdown from "./RepoMarkdown.jsx";

function Section({ label, title, children, loading }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 print:break-inside-avoid print:border-0 print:px-0">
      <div className="text-[10px] font-semibold tracking-widest text-accent uppercase">{label}</div>
      <h2 className="mt-1 mb-3 text-lg font-semibold">{title}</h2>
      {loading ? <Skeleton /> : children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[90, 75, 82].map((w) => (
        <div key={w} className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function FileLink({ path, fileUrl }) {
  return (
    <a href={fileUrl(path)} target="_blank" rel="noreferrer" className="font-mono text-sm text-teal-800 hover:underline">
      {path}
    </a>
  );
}

/**
 * Renders whatever parts of the analysis exist so far, so sections fill in as
 * pipeline steps complete. `a` is a partial or complete Analysis.
 */
export default function AnalysisView({ a, fileUrl, running }) {
  const [showAllSummaries, setShowAllSummaries] = useState(false);
  const summaries = a.fileSummaries ?? [];
  const [printing, setPrinting] = useState(false);
  const visibleSummaries = showAllSummaries || printing ? summaries : summaries.slice(0, 6);
  const known = useMemo(() => knownPaths(a), [a]);

  // Printing (Export → Save as PDF) includes every file summary, not just the first 6.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <div className="space-y-5">
      <Section label="Overview" title="What this project is" loading={!a.overview && running}>
        {a.classification && (
          <div className="mb-3 flex flex-wrap gap-2">
            {[a.classification.projectType, a.classification.primaryLanguage, a.classification.framework]
              .filter((t) => t && t.toLowerCase() !== "none")
              .map((t) => (
                <span key={t} className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  {t}
                </span>
              ))}
          </div>
        )}
        {a.classification?.purpose && <p className="mb-3 font-medium text-slate-900">{a.classification.purpose}</p>}
        <div className="prose-md">
          <RepoMarkdown known={known} fileUrl={fileUrl}>
            {a.overview}
          </RepoMarkdown>
        </div>
      </Section>

      <Section label="Architecture" title="How the pieces connect" loading={!a.architecture && running}>
        <div className="prose-md">
          <RepoMarkdown known={known} fileUrl={fileUrl}>
            {a.architecture}
          </RepoMarkdown>
        </div>
        {a.layers?.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {a.layers.map((layer) => (
              <div key={layer.name} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold">{layer.name}</div>
                <p className="mt-1 text-sm text-slate-600">{layer.description}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {layer.files.map((f) => (
                    <FileLink key={f} path={f} fileUrl={fileUrl} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {a.nonObvious && (
          <div className="mt-4 rounded-r-md border-l-4 border-accent bg-accent-soft px-4 py-3 text-sm text-slate-700">
            <strong className="text-accent">Not obvious from the file names: </strong>
            {a.nonObvious}
          </div>
        )}
      </Section>

      <Section label="Reading order" title="Read these files first" loading={!a.readingOrder && running}>
        <ol className="space-y-3">
          {(a.readingOrder ?? []).map((r, i) => (
            <li key={r.file} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                {i + 1}
              </span>
              <div>
                <FileLink path={r.file} fileUrl={fileUrl} />
                <p className="text-sm text-slate-600">{r.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section label="Confusion map" title="What will trip you up" loading={!a.confusionMap && running}>
        <div className="space-y-3">
          {(a.confusionMap ?? []).map((c) => (
            <div key={c.issue} className="rounded-r-md border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
              <div className="font-semibold text-amber-900">{c.issue}</div>
              <p className="mt-1 text-sm text-slate-700">{c.detail}</p>
              {c.files.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {c.files.map((f) => (
                    <FileLink key={f} path={f} fileUrl={fileUrl} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {(summaries.length > 0 || (a.selectedFiles && running)) && (
        <Section label="Key files" title={`File-by-file (${summaries.length || a.selectedFiles?.length || 0} files)`} loading={!summaries.length && running}>
          <div className="divide-y divide-slate-100">
            {visibleSummaries.map((f) => (
              <div key={f.path} className="py-3 first:pt-0">
                <FileLink path={f.path} fileUrl={fileUrl} />
                <p className="mt-1 text-sm text-slate-700">{f.purpose}</p>
                {f.exports.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="font-medium">Exports:</span> {f.exports.join(", ")}
                  </p>
                )}
              </div>
            ))}
          </div>
          {summaries.length > 6 && (
            <button
              onClick={() => setShowAllSummaries((v) => !v)}
              className="mt-3 text-sm font-medium text-accent hover:underline print:hidden"
            >
              {showAllSummaries ? "Show fewer" : `Show all ${summaries.length} files`}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}
