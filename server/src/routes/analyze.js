import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { allowNewAnalysis } from "../middleware/analyzeLimiter.js";
import { withGithub } from "../middleware/auth.js";
import { Analysis } from "../models/Analysis.js";
import { Job } from "../models/Job.js";
import { UserAnalysis } from "../models/UserAnalysis.js";
import { STEPS } from "../pipeline/index.js";
import { enqueue, getLiveJob, joinInFlight } from "../queue.js";
import { findJobForViewer } from "../services/access.js";
import { buildMarkdown, exportFilename } from "../services/exportMarkdown.js";
import { getRepoMeta, normalizeRef, notFoundOrPrivate, parseRepoUrl, resolveCommitSha } from "../services/github.js";
import { saveToHistory } from "../services/history.js";

export const analyzeRouter = Router();

const CACHE_FIELDS = "repoUrl commitSha ref private repoMeta classification";

// POST /api/analyze { url, ref? } — returns { jobId, status, cached } immediately.
// `ref` is a branch, tag or commit SHA; the default branch when omitted.
analyzeRouter.post("/", async (req, res, next) => {
  try {
    const parsed = parseRepoUrl(req.body?.url);
    if (!parsed) return res.status(400).json({ error: "Enter a URL like https://github.com/owner/repo" });
    const requestedRef = normalizeRef(req.body?.ref);
    if (requestedRef === undefined) {
      return res.status(400).json({ error: "That doesn't look like a valid branch, tag or commit SHA." });
    }

    const { meta, commitSha, token } = await withGithub(req, async (token) => {
      const meta = await getRepoMeta(parsed.owner, parsed.repo, token);
      // The server's own GITHUB_TOKEN may be able to see private repos; only a user's own token counts.
      if (meta.private && !token) throw notFoundOrPrivate();
      const commitSha = await resolveCommitSha(meta.owner, meta.name, requestedRef ?? meta.defaultBranch, token);
      return { meta, commitSha, token };
    });
    const user = req.user;
    const isPrivate = Boolean(meta.private);
    const ref = requestedRef ?? meta.defaultBranch;
    // From GitHub's canonical name, so renamed/redirected repos share one cache entry.
    const repoUrl = `https://github.com/${meta.fullName}`.toLowerCase();

    // Cache hit: same repo at the same commit was already analysed (private: by this user).
    const scope = isPrivate ? { private: true, ownerId: user._id } : { private: { $ne: true } };
    const cached = await Analysis.findOne({ repoUrl, commitSha, ...scope }).select(CACHE_FIELDS).lean();
    if (cached) {
      if (user) {
        // Reuse the link already in "My analyses" rather than minting a new one.
        const existing = await UserAnalysis.findOne({ userId: user._id, analysisId: cached._id }).lean();
        if (existing && (await Job.exists({ jobId: existing.jobId }))) {
          await Job.updateOne({ jobId: existing.jobId }, { ref });
          await saveToHistory({ userId: user._id, analysis: cached, jobId: existing.jobId, ref });
          return res.json({ jobId: existing.jobId, status: "done", cached: true });
        }
        if (existing) await UserAnalysis.deleteOne({ _id: existing._id });
      }
      const jobId = randomUUID();
      await Job.create({
        jobId,
        repoUrl,
        commitSha,
        ref,
        private: isPrivate,
        userId: user?._id,
        status: "done",
        currentStep: 5,
        analysisId: cached._id,
        cached: true,
      });
      if (user) await saveToHistory({ userId: user._id, analysis: cached, jobId, ref });
      return res.json({ jobId, status: "done", cached: true });
    }

    // Same repo+commit already running: share that job.
    const inFlight = joinInFlight(repoUrl, commitSha, { isPrivate, userId: user?._id });
    if (inFlight) return res.json({ jobId: inFlight, status: "running", cached: false });

    if (!allowNewAnalysis(user ? `user:${user._id}` : `ip:${req.ip}`)) {
      return res.status(429).json({
        error: `Limit reached: ${config.analyzeLimitPerHour} new analyses per hour. Cached repos still load instantly.`,
      });
    }

    const jobId = randomUUID();
    await Job.create({ jobId, repoUrl, commitSha, ref, private: isPrivate, userId: user?._id, status: "queued" });
    enqueue({ jobId, repoUrl, commitSha, ref, owner: meta.owner, repo: meta.name, meta, token, userId: user?._id });
    res.status(202).json({ jobId, status: "queued", cached: false });
  } catch (err) {
    next(err);
  }
});

// GET /api/analyze/:jobId/stream — SSE: step_start, step_progress, step_complete, done, error.
analyzeRouter.get("/:jobId/stream", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const job = await findJobForViewer(jobId, req.user);
    if (!job) return res.status(404).json({ error: "Job not found or expired." });
    const liveJob = getLiveJob(jobId);

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const send = ({ event, data }) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write(`event: steps\ndata: ${JSON.stringify(STEPS)}\n\n`);

    if (!liveJob) {
      if (job.status === "done") send({ event: "done", data: { analysisId: job.analysisId.toString() } });
      else if (job.status === "error") send({ event: "error", data: { message: job.error } });
      else send({ event: "error", data: { message: "This job was interrupted (the server restarted). Please run it again." } });
      return res.end();
    }

    liveJob.events.forEach(send);
    if (liveJob.finished) return res.end();

    const onEvent = (e) => {
      send(e);
      if (e.event === "done" || e.event === "error") cleanup();
    };
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    function cleanup() {
      clearInterval(heartbeat);
      liveJob.emitter.off("event", onEvent);
      res.end();
    }
    liveJob.emitter.on("event", onEvent);
    req.on("close", cleanup);
  } catch (err) {
    next(err);
  }
});

// GET /api/analyze/:jobId/export?format=walkthrough|onboarding — Markdown download.
analyzeRouter.get("/:jobId/export", async (req, res, next) => {
  try {
    const mode = req.query.format === "onboarding" ? "onboarding" : "walkthrough";
    const job = await findJobForViewer(req.params.jobId, req.user);
    if (!job?.analysisId) return res.status(404).json({ error: "Analysis not found or not finished yet." });
    const analysis = await Analysis.findById(job.analysisId).lean();
    if (!analysis) return res.status(404).json({ error: "Analysis has expired. Run it again." });

    const filename = exportFilename(analysis, mode);
    res.set({
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    });
    res.send(buildMarkdown(analysis, { mode, ref: job.ref }));
  } catch (err) {
    next(err);
  }
});

// GET /api/analyze/:jobId — job status plus the full analysis once done.
analyzeRouter.get("/:jobId", async (req, res, next) => {
  try {
    const job = await findJobForViewer(req.params.jobId, req.user);
    if (!job) return res.status(404).json({ error: "Job not found or expired." });
    const analysis = job.analysisId ? await Analysis.findById(job.analysisId).select("-ownerId -expireAt").lean() : null;

    let saved = false;
    if (req.user && analysis) {
      const entry = await UserAnalysis.findOneAndUpdate(
        { userId: req.user._id, analysisId: analysis._id },
        { $set: { lastOpenedAt: new Date() } },
      ).lean();
      saved = Boolean(entry);
    }

    res.json({
      job: {
        jobId: job.jobId,
        repoUrl: job.repoUrl,
        commitSha: job.commitSha,
        ref: job.ref ?? analysis?.ref,
        private: Boolean(job.private),
        status: job.status,
        currentStep: job.currentStep,
        cached: job.cached,
        error: job.error,
      },
      analysis,
      saved,
    });
  } catch (err) {
    next(err);
  }
});
