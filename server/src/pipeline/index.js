import { LIMITS, MODELS } from "../config.js";
import { generateJson } from "../services/claude.js";
import { getFileContent, getFileTree } from "../services/github.js";
import { findManifest, findReadme, prepareTreeForSelection, topLevelTree } from "./fileFilter.js";
import * as P from "./prompts.js";

export const STEPS = [
  { step: 1, label: "Classifying repo" },
  { step: 2, label: "Selecting key files" },
  { step: 3, label: "Analysing key files" },
  { step: 4, label: "Synthesising architecture" },
  { step: 5, label: "Mapping confusing parts" },
];

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * The 5-step analysis. `emit(event, data)` reports progress; each step's
 * output is emitted as soon as it exists so the UI can render progressively.
 */
export async function runPipeline({ owner, repo, sha, meta, token, emit }) {
  // Private repos are read with the user's token through the contents API.
  const fileOpts = { token, isPrivate: Boolean(meta.private) };
  const readFile = (path) => getFileContent(owner, repo, sha, path, fileOpts);
  const start = (step) => emit("step_start", STEPS[step - 1]);
  const done = (step, data) => emit("step_complete", { ...STEPS[step - 1], data });

  const { files, truncated } = await getFileTree(owner, repo, sha, token);
  if (files.length === 0) throw new Error("This repository has no files to analyse.");
  const allPaths = new Set(files.map((f) => f.path));

  // ── Step 1: classify ──
  start(1);
  const readmePath = findReadme(files);
  const manifestPath = findManifest(files);
  const [readme, manifest] = await Promise.all([
    readmePath ? readFile(readmePath) : null,
    manifestPath ? readFile(manifestPath) : null,
  ]);

  const classification = await generateJson({
    model: MODELS.fast,
    system: P.CLASSIFY_SYSTEM,
    schema: P.CLASSIFY_SCHEMA,
    maxTokens: 2000,
    prompt: [
      `Repository: ${meta.fullName}`,
      `Description: ${meta.description || "(none)"}`,
      `GitHub-detected language: ${meta.language || "(unknown)"}`,
      `\nTop-level layout:\n${topLevelTree(files).join("\n")}`,
      manifest ? `\n<file path="${manifestPath}">\n${manifest.slice(0, 8000)}\n</file>` : "\n(No dependency manifest found at the root.)",
      readme ? `\n<file path="${readmePath}">\n${readme.slice(0, 6000)}\n</file>` : "\n(No README found.)",
    ].join("\n"),
  });
  done(1, classification);

  // ── Step 2: select key files ──
  start(2);
  const tree = prepareTreeForSelection(files);
  if (tree.paths.length === 0) throw new Error("No source files found after filtering out dependencies and build output.");

  const selection = await generateJson({
    model: MODELS.fast,
    system: P.SELECT_SYSTEM,
    schema: P.selectSchema(LIMITS.maxSelectedFiles),
    maxTokens: 4000,
    prompt: [
      `Repository: ${meta.fullName}`,
      `Classification: ${classification.projectType}, ${classification.primaryLanguage}, framework: ${classification.framework}`,
      `Purpose: ${classification.purpose}`,
      `\nSelect up to ${LIMITS.maxSelectedFiles} files, most important first.`,
      tree.omitted > 0 || truncated
        ? `Note: the list below is partial (${tree.paths.length} of ${tree.totalFiles} files shown, deepest paths omitted).`
        : "",
      `\nFile list:\n${tree.paths.join("\n")}`,
    ].join("\n"),
  });

  // Guard against hallucinated or duplicate paths.
  const seen = new Set();
  const selectedFiles = selection.files
    .filter((f) => allPaths.has(f.path) && !seen.has(f.path) && seen.add(f.path))
    .slice(0, LIMITS.maxSelectedFiles);
  if (selectedFiles.length === 0) throw new Error("File selection returned no valid paths.");
  done(2, { selectedFiles });

  // ── Step 3: per-file analysis, batches of 5 ──
  start(3);
  const contents = await mapLimit(selectedFiles, 8, async (f) => ({
    path: f.path,
    content: await readFile(f.path),
  }));
  const readable = contents.filter((c) => c.content !== null && c.content.trim() !== "");
  const batches = chunk(readable, LIMITS.batchSize);
  let completedBatches = 0;

  const batchResults = await mapLimit(batches, LIMITS.batchConcurrency, async (batch) => {
    const result = await generateJson({
      model: MODELS.main,
      effort: "low",
      system: P.FILES_SYSTEM,
      schema: P.FILES_SCHEMA,
      maxTokens: 8000,
      prompt:
        `Repository: ${meta.fullName} (${classification.projectType}, ${classification.framework})\n\n` +
        batch.map((c) => `<file path="${c.path}">\n${c.content}\n</file>`).join("\n\n"),
    });
    completedBatches++;
    emit("step_progress", { step: 3, completed: completedBatches, total: batches.length });
    const batchPaths = new Set(batch.map((c) => c.path));
    return result.summaries.filter((s) => batchPaths.has(s.path));
  });

  const order = new Map(selectedFiles.map((f, i) => [f.path, i]));
  const fileSummaries = batchResults.flat().sort((a, b) => order.get(a.path) - order.get(b.path));
  done(3, { fileSummaries });

  // ── Step 4: synthesise architecture ──
  start(4);
  const summaryText = fileSummaries
    .map((f) => `### ${f.path}\n${f.purpose}\nExports: ${f.exports.join(", ") || "—"}\nDepends on: ${f.dependsOn.join(", ") || "—"}`)
    .join("\n\n");

  const synthesis = await generateJson({
    model: MODELS.main,
    effort: "medium",
    system: P.synthesisSystem({
      repoName: meta.fullName,
      projectType: classification.projectType,
      framework: classification.framework,
    }),
    schema: P.SYNTHESIS_SCHEMA,
    prompt: `Project purpose: ${classification.purpose}\n\nFile summaries:\n\n${summaryText}`,
  });
  synthesis.suggestedQuestions = (synthesis.suggestedQuestions ?? [])
    .filter((q) => typeof q === "string" && q.trim())
    .map((q) => q.trim())
    .slice(0, LIMITS.maxSuggestedQuestions);
  done(4, synthesis);

  // ── Step 5: confusion map ──
  start(5);
  const confusion = await generateJson({
    model: MODELS.main,
    effort: "medium",
    system: P.CONFUSION_SYSTEM,
    schema: P.CONFUSION_SCHEMA,
    prompt:
      `Repository: ${meta.fullName}\n\n## Architecture\n${synthesis.architecture}\n\n` +
      `## Not obvious\n${synthesis.nonObvious}\n\n## File summaries\n\n${summaryText}`,
  });
  done(5, confusion);

  return {
    classification: {
      projectType: classification.projectType,
      primaryLanguage: classification.primaryLanguage,
      framework: classification.framework,
      purpose: classification.purpose,
    },
    overview: classification.overview,
    selectedFiles,
    fileSummaries,
    architecture: synthesis.architecture,
    layers: synthesis.layers,
    readingOrder: synthesis.readingOrder,
    nonObvious: synthesis.nonObvious,
    suggestedQuestions: synthesis.suggestedQuestions,
    confusionMap: confusion.confusionMap,
  };
}
