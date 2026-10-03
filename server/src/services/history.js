import { TTL_MS } from "../config.js";
import { Analysis } from "../models/Analysis.js";
import { ChatSession } from "../models/ChatSession.js";
import { Job } from "../models/Job.js";
import { UserAnalysis } from "../models/UserAnalysis.js";

/**
 * Adds (or refreshes) an analysis in the user's "My analyses" and stops the analysis, the
 * job behind its link and the user's chats about it from expiring. An existing entry keeps
 * its original jobId so links the user already has keep working.
 */
export async function saveToHistory({ userId, analysis, jobId, ref }) {
  const now = new Date();
  const m = analysis.repoMeta ?? {};
  const entry = await UserAnalysis.findOneAndUpdate(
    { userId, analysisId: analysis._id },
    {
      $set: {
        repoUrl: analysis.repoUrl,
        fullName: m.fullName,
        htmlUrl: m.htmlUrl,
        description: m.description,
        language: m.language,
        stars: m.stars,
        private: Boolean(analysis.private),
        ref: ref ?? analysis.ref ?? m.defaultBranch,
        commitSha: analysis.commitSha,
        projectType: analysis.classification?.projectType,
        purpose: analysis.classification?.purpose,
        lastOpenedAt: now,
      },
      $setOnInsert: { jobId, createdAt: now },
    },
    { upsert: true, new: true },
  ).lean();

  await Promise.all([
    Analysis.updateOne({ _id: analysis._id }, { $unset: { expireAt: 1 } }),
    Job.updateOne({ jobId: entry.jobId }, { $unset: { expireAt: 1 } }),
    ChatSession.updateMany({ userId, analysisId: analysis._id }, { $unset: { expireAt: 1 } }),
  ]);
  return entry;
}

/**
 * Removes an entry and the user's chats about it. Once nothing references them, public
 * analyses and jobs fall back to normal expiry (they still serve as the shared cache);
 * private ones are deleted immediately.
 */
export async function removeFromHistory(entry) {
  await UserAnalysis.deleteOne({ _id: entry._id });
  await ChatSession.deleteMany({ userId: entry.userId, analysisId: entry.analysisId });
  const now = Date.now();

  if (!(await UserAnalysis.exists({ jobId: entry.jobId }))) {
    if (entry.private) await Job.deleteOne({ jobId: entry.jobId });
    else await Job.updateOne({ jobId: entry.jobId }, { $set: { expireAt: new Date(now + TTL_MS.job) } });
  }

  if (!(await UserAnalysis.exists({ analysisId: entry.analysisId }))) {
    if (entry.private) {
      await Promise.all([
        Analysis.deleteOne({ _id: entry.analysisId }),
        Job.deleteMany({ analysisId: entry.analysisId }),
        ChatSession.deleteMany({ analysisId: entry.analysisId }),
      ]);
    } else {
      await Analysis.updateOne({ _id: entry.analysisId }, { $set: { expireAt: new Date(now + TTL_MS.analysis) } });
    }
  }
}
