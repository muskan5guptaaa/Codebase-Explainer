import { useEffect, useState } from "react";
import { api, errorMessage } from "../api.js";

const CUSTOM = "__custom__";
const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * Branch / tag / commit picker. `value` is the ref to analyse; "" means the default branch.
 * Lists the first 100 branches and tags; anything else (including commit SHAs) can be typed.
 */
export default function RefPicker({ repoUrl, value, onChange }) {
  const [refs, setRefs] = useState(null);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    setRefs(null);
    setError("");
    const controller = new AbortController();
    api
      .get("/repo-meta/refs", { params: { url: repoUrl }, signal: controller.signal })
      .then((r) => setRefs(r.data))
      .catch((err) => !controller.signal.aborted && setError(errorMessage(err)));
    return () => controller.abort();
  }, [repoUrl]);

  // A ref passed in (e.g. from ?ref= after signing in) that isn't listed starts in custom mode.
  useEffect(() => {
    if (refs && value && !refs.branches.includes(value) && !refs.tags.includes(value)) setCustom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs]);

  const selectValue = custom
    ? CUSTOM
    : !value || value === refs?.defaultBranch
      ? `b:${refs?.defaultBranch ?? ""}`
      : refs?.tags.includes(value) && !refs.branches.includes(value)
        ? `t:${value}`
        : `b:${value}`;

  function onSelect(e) {
    const v = e.target.value;
    if (v === CUSTOM) {
      setCustom(true);
      onChange("");
      return;
    }
    setCustom(false);
    const name = v.slice(2);
    onChange(name === refs.defaultBranch ? "" : name);
  }

  if (error) {
    return (
      <div className="mt-4">
        <label htmlFor="ref-input" className="text-sm font-medium text-slate-700">
          Branch, tag or commit <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="ref-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Default branch"
          className={`mt-1 w-full font-mono ${inputClass}`}
        />
        <p className="mt-1 text-xs text-slate-500">Couldn't list branches ({error}). Leave empty to use the default branch.</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <label htmlFor="ref-select" className="text-sm font-medium text-slate-700">
        Branch, tag or commit
      </label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <select
          id="ref-select"
          value={refs ? selectValue : ""}
          onChange={onSelect}
          disabled={!refs}
          className={`min-w-0 sm:max-w-xs ${inputClass} disabled:text-slate-400`}
        >
          {!refs && <option value="">Loading branches…</option>}
          {refs && (
            <optgroup label="Branches">
              {refs.branches.map((b) => (
                <option key={b} value={`b:${b}`}>
                  {b}
                  {b === refs.defaultBranch ? " (default, latest commit)" : ""}
                </option>
              ))}
            </optgroup>
          )}
          {refs?.tags.length > 0 && (
            <optgroup label="Tags">
              {refs.tags.map((t) => (
                <option key={t} value={`t:${t}`}>
                  {t}
                </option>
              ))}
            </optgroup>
          )}
          {refs && <option value={CUSTOM}>Other branch, tag or commit SHA…</option>}
        </select>
        {custom && (
          <input
            aria-label="Branch, tag or commit SHA"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. release/2.0, v1.4.2 or a1b2c3d"
            className={`min-w-0 flex-1 font-mono ${inputClass}`}
            autoFocus
          />
        )}
      </div>
      {custom && <p className="mt-1 text-xs text-slate-500">Leave empty to use the default branch.</p>}
      {refs && !custom && (refs.moreBranches || refs.moreTags) && (
        <p className="mt-1 text-xs text-slate-500">
          Showing the first 100 {refs.moreBranches && refs.moreTags ? "branches and tags" : refs.moreBranches ? "branches" : "tags"}.
          Choose "Other" to type any name.
        </p>
      )}
    </div>
  );
}
