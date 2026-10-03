const DEFAULT_STEPS = [
  { step: 1, label: "Classifying repo" },
  { step: 2, label: "Selecting key files" },
  { step: 3, label: "Analysing key files" },
  { step: 4, label: "Synthesising architecture" },
  { step: 5, label: "Mapping confusing parts" },
];

/** status: { [step]: "pending" | "running" | "done" }, batch: { completed, total } for step 3 */
export default function ProgressSteps({ steps = DEFAULT_STEPS, status, batch }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-5">
      {steps.map(({ step, label }) => {
        const s = status[step] ?? "pending";
        return (
          <li
            key={step}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              s === "done"
                ? "border-teal-200 bg-accent-soft text-accent"
                : s === "running"
                  ? "border-accent bg-white text-slate-900"
                  : "border-slate-200 bg-white text-slate-400"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                s === "done" ? "bg-accent text-white" : s === "running" ? "border-2 border-accent text-accent" : "border border-slate-300"
              }`}
            >
              {s === "done" ? "✓" : step}
            </span>
            <span className="leading-tight">
              {label}
              {s === "running" && step === 3 && batch?.total ? ` (${batch.completed}/${batch.total})` : ""}
              {s === "running" && <span className="ml-1 inline-block animate-pulse">…</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
