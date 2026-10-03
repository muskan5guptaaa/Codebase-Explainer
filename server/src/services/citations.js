// Chat answers cite files by their repo-relative path. Only paths the analysis knows about
// count, so a hallucinated path never becomes a link.

/** Every file path that appears anywhere in the analysis. */
export function knownPaths(analysis) {
  const paths = new Set();
  for (const f of analysis.selectedFiles ?? []) paths.add(f.path);
  for (const f of analysis.fileSummaries ?? []) paths.add(f.path);
  for (const l of analysis.layers ?? []) l.files?.forEach((p) => paths.add(p));
  for (const r of analysis.readingOrder ?? []) paths.add(r.file);
  for (const c of analysis.confusionMap ?? []) c.files?.forEach((p) => paths.add(p));
  paths.delete(undefined);
  paths.delete("");
  return paths;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Known paths mentioned in `text`, in order of first mention. */
export function extractCitations(text, paths, max = 10) {
  const found = [];
  for (const path of paths) {
    // Not part of a longer path: "src/app.js" must not match inside "src/app.json" or "lib/src/app.js".
    const re = new RegExp(`(?<![\\w./-])${escapeRegex(path)}(?![\\w/-]|\\.\\w)`);
    const m = re.exec(text);
    if (m) found.push({ path, index: m.index });
  }
  return found
    .sort((a, b) => a.index - b.index)
    .slice(0, max)
    .map((f) => f.path);
}
