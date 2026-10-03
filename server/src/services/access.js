import { Job } from "../models/Job.js";

/**
 * Loads a job if this viewer may see it. Public jobs are readable by anyone with the link;
 * private ones only by the user who ran them. Returns null otherwise (a 404 for the caller,
 * so private jobs aren't distinguishable from missing ones).
 */
export async function findJobForViewer(jobId, user) {
  if (typeof jobId !== "string" || !jobId || jobId.length > 100) return null;
  const job = await Job.findOne({ jobId }).lean();
  if (!job) return null;
  if (job.private && !(user && String(job.userId) === String(user._id))) return null;
  return job;
}
