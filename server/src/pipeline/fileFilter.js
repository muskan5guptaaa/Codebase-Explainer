import { LIMITS } from "../config.js";

// Deterministic guardrail that runs before the model ever sees the tree:
// drops dependencies, build output, lock files, binaries and generated code.
const IGNORED_DIRS = new Set([
  "node_modules", "bower_components", "vendor", ".git", ".github", ".idea", ".vscode",
  "dist", "build", "out", "target", "bin", "obj", ".next", ".nuxt", ".svelte-kit",
  ".output", "coverage", "__pycache__", ".venv", "venv", "env", ".tox", ".mypy_cache",
  ".pytest_cache", ".gradle", ".cache", "tmp", "temp", "public/assets", "__snapshots__",
  "fixtures", "__fixtures__", "testdata",
]);

const IGNORED_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "composer.lock",
  "Gemfile.lock", "poetry.lock", "Pipfile.lock", "Cargo.lock", "go.sum", "mix.lock",
  ".DS_Store", "Thumbs.db",
]);

const BINARY_OR_ASSET_EXT = /\.(png|jpe?g|gif|bmp|ico|svg|webp|avif|tiff?|psd|mp[34]|mov|avi|webm|wav|ogg|flac|woff2?|ttf|otf|eot|zip|tar|gz|tgz|rar|7z|jar|war|exe|dll|so|dylib|o|a|class|pyc|pdf|docx?|xlsx?|pptx?|db|sqlite3?|bin|dat|lock|map)$/i;
const GENERATED = /(\.min\.(js|css)$|\.bundle\.js$|\.chunk\.js$|\.generated\.|_pb2\.py$|\.pb\.go$|\.d\.ts$)/i;

export function isCandidate({ path, size }) {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  if (IGNORED_FILES.has(file)) return false;
  for (let i = 0; i < parts.length - 1; i++) {
    if (IGNORED_DIRS.has(parts[i]) || IGNORED_DIRS.has(parts.slice(0, i + 1).join("/"))) return false;
  }
  if (BINARY_OR_ASSET_EXT.test(file) || GENERATED.test(file)) return false;
  if (size > 500_000) return false;
  return true;
}

/**
 * Filters the tree and, if it is still huge, keeps the shallowest paths
 * (entry points and config live near the root). Returns the list sent to Step 2.
 */
export function prepareTreeForSelection(files) {
  const candidates = files.filter(isCandidate);
  const sorted = [...candidates].sort(
    (a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path),
  );
  const kept = sorted.slice(0, LIMITS.maxTreePathsForSelection);
  return {
    paths: kept.map((f) => f.path).sort(),
    omitted: candidates.length - kept.length,
    totalFiles: files.length,
  };
}

/** Top-level view for Step 1: root entries plus one level of folders. */
export function topLevelTree(files) {
  const entries = new Set();
  for (const { path } of files) {
    const parts = path.split("/");
    entries.add(parts.length === 1 ? parts[0] : `${parts[0]}/`);
    if (parts.length > 2) entries.add(`${parts[0]}/${parts[1]}/`);
    else if (parts.length === 2) entries.add(`${parts[0]}/${parts[1]}`);
  }
  return [...entries].sort().slice(0, 300);
}

const MANIFESTS = [
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "mix.exs",
  "pubspec.yaml", "Package.swift", "CMakeLists.txt",
];

export function findManifest(files) {
  const rootPaths = new Set(files.filter((f) => !f.path.includes("/")).map((f) => f.path));
  return MANIFESTS.find((m) => rootPaths.has(m)) ?? null;
}

export function findReadme(files) {
  return files.find((f) => /^readme(\.(md|rst|txt))?$/i.test(f.path))?.path ?? null;
}
