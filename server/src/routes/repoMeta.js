import { Router } from "express";
import { withGithub } from "../middleware/auth.js";
import { getRepoMeta, listRefs, notFoundOrPrivate, parseRepoUrl } from "../services/github.js";

export const repoMetaRouter = Router();

/** Repo metadata as the requester is allowed to see it (private repos need their own token). */
async function metaFor(req, fn) {
  const parsed = parseRepoUrl(req.query.url);
  if (!parsed) {
    const err = new Error("Enter a URL like https://github.com/owner/repo");
    err.status = 400;
    throw err;
  }
  return withGithub(req, async (token) => {
    const meta = await getRepoMeta(parsed.owner, parsed.repo, token);
    if (meta.private && !token) throw notFoundOrPrivate();
    return fn ? fn(meta, token) : meta;
  });
}

// GET /api/repo-meta?url=... — metadata only, no AI call.
repoMetaRouter.get("/", async (req, res, next) => {
  try {
    res.json(await metaFor(req));
  } catch (err) {
    next(err);
  }
});

// GET /api/repo-meta/refs?url=... — branches and tags for the ref picker.
repoMetaRouter.get("/refs", async (req, res, next) => {
  try {
    res.json(await metaFor(req, (meta, token) => listRefs(meta.owner, meta.name, meta.defaultBranch, token)));
  } catch (err) {
    next(err);
  }
});
