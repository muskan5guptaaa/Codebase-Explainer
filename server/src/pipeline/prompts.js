// System prompts and JSON schemas for the 5 pipeline steps.
// Every schema is strict (all properties required, no extras) as structured outputs require.

const SPECIFIC =
  "Be specific. Name actual files, functions and folders from this repository. " +
  'Avoid generic phrases like "the backend handles API requests"; say instead, for example, ' +
  '"routes/auth.js defines the JWT middleware applied to all /api/v1/* routes."';

// ── Step 1: classify ────────────────────────────────────────────────────────
export const CLASSIFY_SYSTEM =
  "You classify software repositories from their metadata, top-level layout, README and dependency manifest. " +
  "Base every claim on the evidence given; if something cannot be determined, say so rather than guessing.";

export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    projectType: { type: "string", description: "e.g. web app, CLI tool, library, REST API, mobile app, monorepo" },
    primaryLanguage: { type: "string" },
    framework: { type: "string", description: "Main framework(s), or 'none'" },
    purpose: { type: "string", description: "One sentence: what problem this project solves" },
    overview: {
      type: "string",
      description: "2 short paragraphs in plain English for a developer who has never seen the repo",
    },
  },
  required: ["projectType", "primaryLanguage", "framework", "purpose", "overview"],
  additionalProperties: false,
};

// ── Step 2: select key files ────────────────────────────────────────────────
export const SELECT_SYSTEM =
  "You choose which files a senior engineer should read to understand a codebase. " +
  "Prefer entry points (main/index/app/server files), routing, core domain models, service layers, " +
  "configuration that shapes runtime behaviour, and the dependency manifest. " +
  "Skip tests, fixtures, generated code, docs other than the README, and near-duplicate files. " +
  "Only return paths that appear verbatim in the provided list.";

export function selectSchema(max) {
  return {
    type: "object",
    properties: {
      files: {
        type: "array",
        description: `Up to ${max} files, most important first`,
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            reason: { type: "string", description: "One sentence on why this file matters" },
          },
          required: ["path", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["files"],
    additionalProperties: false,
  };
}

// ── Step 3: per-file analysis ───────────────────────────────────────────────
export const FILES_SYSTEM =
  "You are a senior engineer reading source files from one repository. For each file, explain what it does, " +
  "what it exports or exposes, and which other files/modules/packages it depends on. " +
  "Summaries must be concrete: mention key functions, classes, routes or config keys by name. " +
  "Return exactly one entry per file provided, using the exact path shown.";

export const FILES_SCHEMA = {
  type: "object",
  properties: {
    summaries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          purpose: { type: "string", description: "2-4 sentences" },
          exports: { type: "array", items: { type: "string" } },
          dependsOn: { type: "array", items: { type: "string" } },
        },
        required: ["path", "purpose", "exports", "dependsOn"],
        additionalProperties: false,
      },
    },
  },
  required: ["summaries"],
  additionalProperties: false,
};

// ── Step 4: synthesise architecture ─────────────────────────────────────────
export function synthesisSystem({ repoName, projectType, framework }) {
  return `You are a senior software architect explaining a codebase to a new team member.
You have read file summaries for the repository ${repoName}.

Project type: ${projectType}
Primary framework: ${framework}

Explain:
1. The overall architecture in 2-3 paragraphs: what the system does and how.
2. How the main layers connect (frontend → API → service → data, or whatever layers actually exist here), using concrete file names.
3. A reading order: the 5 files a new developer should read first, and why, in order.
4. One thing that is NOT obvious from the file names alone.
5. 4-6 questions a developer new to this repository would realistically ask next. Make them specific to this
   codebase (name its features, files or concepts), answerable from the file summaries, and phrased the way the
   developer would type them, e.g. "How does the retry logic in services/queue.js decide when to give up?".

${SPECIFIC}
The architecture text may use Markdown (paragraphs, bullet lists, inline code for file names). Do not use headings.`;
}

export const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    architecture: { type: "string", description: "2-3 paragraphs of Markdown" },
    layers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "files"],
        additionalProperties: false,
      },
    },
    readingOrder: {
      type: "array",
      description: "Exactly 5 entries, in the order to read them",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          reason: { type: "string" },
        },
        required: ["file", "reason"],
        additionalProperties: false,
      },
    },
    nonObvious: { type: "string" },
    suggestedQuestions: {
      type: "array",
      description: "4-6 repo-specific questions a new developer would ask next",
      items: { type: "string" },
    },
  },
  required: ["architecture", "layers", "readingOrder", "nonObvious", "suggestedQuestions"],
  additionalProperties: false,
};

// ── Step 5: confusion map ───────────────────────────────────────────────────
export const CONFUSION_SYSTEM =
  "You review a codebase for the things most likely to confuse or surprise a developer new to it: " +
  "unusual patterns, missing or leaky abstractions, naming inconsistencies, duplicated responsibilities, " +
  "hidden coupling, surprising control flow, and architectural oddities. " +
  "Pick the 3-5 that matter most. For each, explain why it is confusing and what the reader should know to get past it. " +
  "Only report issues supported by the summaries; do not invent problems. " +
  SPECIFIC;

export const CONFUSION_SCHEMA = {
  type: "object",
  properties: {
    confusionMap: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue: { type: "string", description: "Short title" },
          detail: { type: "string", description: "2-4 sentences" },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["issue", "detail", "files"],
        additionalProperties: false,
      },
    },
  },
  required: ["confusionMap"],
  additionalProperties: false,
};

// ── Chat ────────────────────────────────────────────────────────────────────
export function chatSystem(analysis) {
  const summaries = analysis.fileSummaries
    .map((f) => `### ${f.path}\n${f.purpose}\nExports: ${f.exports.join(", ") || "—"}\nDepends on: ${f.dependsOn.join(", ") || "—"}`)
    .join("\n\n");
  const confusion = analysis.confusionMap.map((c) => `- ${c.issue}: ${c.detail}`).join("\n");
  const reading = analysis.readingOrder.map((r, i) => `${i + 1}. ${r.file} — ${r.reason}`).join("\n");

  return `You answer follow-up questions about the GitHub repository ${analysis.repoMeta.fullName} (commit ${analysis.commitSha.slice(0, 7)}).
You have an analysis of the repository below. Answer from it, naming specific files and functions.
If the analysis does not cover what is asked, say so plainly and suggest which file the user should open to find out. Do not invent code that isn't described.
Whenever you mention a file, write its full repository-relative path in backticks exactly as it appears in the analysis (for example \`${analysis.fileSummaries[0]?.path ?? "src/index.js"}\`), never just the file name, so it can be linked.
Keep answers concise and use Markdown.

<analysis>
## Overview
${analysis.overview}

## Architecture
${analysis.architecture}

## Reading order
${reading}

## Not obvious
${analysis.nonObvious}

## Confusion map
${confusion}

## File summaries
${summaries}
</analysis>`;
}
