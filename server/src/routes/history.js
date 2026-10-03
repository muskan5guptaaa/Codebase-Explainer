import { Router } from "express";
import mongoose from "mongoose";
import { requireUser } from "../middleware/auth.js";
import { Analysis } from "../models/Analysis.js";
import { UserAnalysis } from "../models/UserAnalysis.js";
import { findJobForViewer } from "../services/access.js";
import { removeFromHistory, saveToHistory } from "../services/history.js";

export const historyRouter = Router();
historyRouter.use(requireUser);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toClient = (e) => ({
  id: e._id,
  jobId: e.jobId,
  fullName: e.fullName,
  htmlUrl: e.htmlUrl,
  description: e.description,
  language: e.language,
  stars: e.stars,
  private: e.private,
  ref: e.ref,
  commitSha: e.commitSha,
  projectType: e.projectType,
  purpose: e.purpose,
  createdAt: e.createdAt,
  lastOpenedAt: e.lastOpenedAt,
});

// GET /api/history?q=&limit=&cursor= — most recently opened first.
historyRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 50);
    const filter = { userId: req.user._id };

    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ fullName: re }, { description: re }, { purpose: re }, { ref: re }];
    }

    // Cursor is "<lastOpenedAt ms>_<id>" of the last item on the previous page.
    const [ms, id] = typeof req.query.cursor === "string" ? req.query.cursor.split("_") : [];
    if (ms && mongoose.isValidObjectId(id) && Number.isFinite(Number(ms))) {
      const at = new Date(Number(ms));
      const after = [{ lastOpenedAt: { $lt: at } }, { lastOpenedAt: at, _id: { $lt: new mongoose.Types.ObjectId(id) } }];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: after }];
        delete filter.$or;
      } else {
        filter.$or = after;
      }
    }

    const rows = await UserAnalysis.find(filter).sort({ lastOpenedAt: -1, _id: -1 }).limit(limit + 1).lean();
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    res.json({
      items: items.map(toClient),
      nextCursor: rows.length > limit ? `${last.lastOpenedAt.getTime()}_${last._id}` : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/history { jobId } — save an analysis opened from a shared link.
historyRouter.post("/", async (req, res, next) => {
  try {
    const job = await findJobForViewer(req.body?.jobId, req.user);
    if (!job?.analysisId) return res.status(404).json({ error: "Analysis not found or not finished yet." });
    const analysis = await Analysis.findById(job.analysisId).select("repoUrl commitSha ref private repoMeta classification").lean();
    if (!analysis) return res.status(404).json({ error: "Analysis has expired. Run it again." });
    const entry = await saveToHistory({ userId: req.user._id, analysis, jobId: job.jobId, ref: job.ref });
    res.status(201).json(toClient(entry));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/history/:id
historyRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Not found." });
    const entry = await UserAnalysis.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!entry) return res.status(404).json({ error: "Not found." });
    await removeFromHistory(entry);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
