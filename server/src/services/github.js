import { Octokit } from "@octokit/rest";
import { config, LIMITS } from "../config.js";

// Retry transient network failures (connect timeouts, resets). HTTP errors have a
// status and are not retried.
function makeClient(auth) {
  const octokit = new Octokit({ auth });
  octokit.hook.wrap("request", async (request, options) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request(options);
      } catch (err) {
        if (err.status || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  });
  return octokit;
}

const serverClient = makeClient(config.githubToken);

/** A signed-in user's own token when given, otherwise the server's GITHUB_TOKEN (or none). */
const client = (token) => (token ? makeClient(token) : serverClient);

export class GitHubError extends Error {
  constructor(message, status = 502, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Accepts github.com/owner/repo URLs (with or without protocol, .git, trailing paths). */
export function parseRepoUrl(input) {
  if (typeof input !== "string") return null;
  const match = input
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match) return null;
  const [, owner, repo] = match;
  return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}`.toLowerCase() };
}

/**
 * Branch, tag or commit SHA as typed by the user. Git forbids whitespace, `..`, `~^:?*[\`
 * and control characters in ref names, so anything containing them can't be a real ref.
 */
export function normalizeRef(input) {
  if (input == null || input === "") return null;
  if (typeof input !== "string") return undefined;
  const ref = input.trim();
  if (!ref || ref.length > 200 || ref.includes("..") || /[\s~^:?*[\\\x00-\x1f\x7f]/.test(ref)) return undefined;
  return ref;
}

export const notFoundOrPrivate = () =>
  new GitHubError("Repository not found, or you don't have access to it.", 404, "not_found_or_private");

function wrap(err) {
  if (err instanceof GitHubError) return err;
  if (err.status === 404) return notFoundOrPrivate();
  if (err.status === 401) {
    return new GitHubError("Your GitHub authorization has expired or was revoked. Sign in again.", 401, "github_auth_invalid");
  }
  const rateLimited =
    err.status === 429 ||
    (err.status === 403 && (err.response?.headers?.["x-ratelimit-remaining"] === "0" || /rate limit/i.test(err.message)));
  if (rateLimited) {
    return new GitHubError(
      "GitHub API rate limit reached. Sign in with GitHub, add a GITHUB_TOKEN to the server .env, or try again later.",
      429,
      "github_rate_limited",
    );
  }
  if (err.status === 403) {
    return new GitHubError(
      "GitHub denied access to this repository. If it belongs to an organization, it may require SSO authorization or approval of this app.",
      403,
      "github_forbidden",
    );
  }
  return new GitHubError(`GitHub API error: ${err.message}`);
}

/** 1 API call. */
export async function getRepoMeta(owner, repo, token) {
  try {
    const { data } = await client(token).repos.get({ owner, repo });
    return {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      description: data.description || "",
      stars: data.stargazers_count,
      language: data.language || "",
      defaultBranch: data.default_branch,
      htmlUrl: data.html_url,
      private: data.private,
    };
  } catch (err) {
    throw wrap(err);
  }
}

/** 1 API call. Resolves a branch name, tag name or (short or full) commit SHA to a full SHA. */
export async function resolveCommitSha(owner, repo, ref, token) {
  try {
    const { data } = await client(token).repos.getCommit({ owner, repo, ref, per_page: 1 });
    return data.sha;
  } catch (err) {
    // 422 "No commit found for SHA" is what GitHub returns for an unknown ref.
    if (err.status === 422 || err.status === 404) {
      throw new GitHubError(`Couldn't find a branch, tag or commit named "${ref}".`, 404, "ref_not_found");
    }
    throw wrap(err);
  }
}

/** 2 API calls. The first page (up to 100) of branches and tags, default branch first. */
export async function listRefs(owner, repo, defaultBranch, token) {
  const gh = client(token);
  const perPage = LIMITS.maxRefsListed;
  try {
    const [branches, tags] = await Promise.all([
      gh.repos.listBranches({ owner, repo, per_page: perPage }),
      gh.repos.listTags({ owner, repo, per_page: perPage }),
    ]);
    const branchNames = branches.data.map((b) => b.name).filter((n) => n !== defaultBranch);
    return {
      defaultBranch,
      branches: [defaultBranch, ...branchNames],
      tags: tags.data.map((t) => t.name),
      // A full page means there may be more; the UI lets the user type any ref.
      moreBranches: branches.data.length === perPage,
      moreTags: tags.data.length === perPage,
    };
  } catch (err) {
    throw wrap(err);
  }
}

/** 1 API call. Returns blob entries only: [{ path, size }]. */
export async function getFileTree(owner, repo, sha, token) {
  try {
    const { data } = await client(token).git.getTree({ owner, repo, tree_sha: sha, recursive: "true" });
    return {
      files: data.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0 })),
      truncated: data.truncated,
    };
  } catch (err) {
    throw wrap(err);
  }
}

function truncate(text) {
  if (text.length <= LIMITS.maxCharsPerFile) return text;
  return (
    text.slice(0, LIMITS.maxCharsPerFile) +
    `\n\n[... file truncated: showing the first ${LIMITS.maxCharsPerFile} of ${text.length} characters ...]`
  );
}

/**
 * Public repos: contents come from raw.githubusercontent.com, which does not count
 * against the REST API rate limit. Private repos: the contents API with the user's
 * token (raw media type, so no base64 and no 1 MB limit). Both are pinned to the
 * commit SHA so content matches the cache key. Returns null if the file can't be read.
 */
export async function getFileContent(owner, repo, sha, path, { token, isPrivate = false } = {}) {
  if (isPrivate) {
    try {
      const { data } = await client(token).request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner,
        repo,
        path,
        ref: sha,
        headers: { accept: "application/vnd.github.raw+json" },
      });
      return typeof data === "string" ? truncate(data) : null;
    } catch (err) {
      if (err.status === 404) return null;
      throw wrap(err);
    }
  }

  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return truncate(await res.text());
}
