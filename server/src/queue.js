import { EventEmitter } from "node:events";
import { Analysis } from "./models/Analysis.js";
import { Job } from "./models/Job.js";
import { runPipeline } from "./pipeline/index.js";
import { describeClaudeError } from "./services/claude.js";
import { saveToHistory } from "./services/history.js";

// In-process job queue (replaces BullMQ + Redis for the MVP).
// Each live job keeps its event history so an SSE client that connects late,
// or reconnects, gets every event replayed before following live ones.

const MAX_CONCURRENT = 2;
const live = new Map(); // jobId -> { emitter, events, finished, repoUrl, commitSha, private, userId, watchers }
const pending = [];
let running = 0;

export function getLiveJob(jobId) {
  return live.get(jobId);
}

/**
 * Running/queued job for the same repo+commit, so duplicate requests share one run.
 * A private job is only shared with the user who started it. A signed-in user who joins
 * a job gets the result saved to their history too.
 */
export function joinInFlight(repoUrl, commitSha, { isPrivate, userId }) {
  for (const [jobId, j] of live) {
    if (j.finished || j.repoUrl !== repoUrl || j.commitSha !== commitSha) continue;
    if (j.private !== isPrivate) continue;
    if (isPrivate && String(j.userId) !== String(userId)) continue;
    if (userId) j.watchers.set(String(userId), userId);
    return jobId;
  }
  return null;
}

/** `token` is the user's GitHub token (private repos), never persisted. */
export function enqueue({ jobId, repoUrl, commitSha, ref, owner, repo, meta, token, userId }) {
  const state = {
    emitter: new EventEmitter(),
    events: [],
    finished: false,
    repoUrl,
    commitSha,
    private: Boolean(meta.private),
    userId,
    watchers: new Map(userId ? [[String(userId), userId]] : []),
  };
  state.emitter.setMaxListeners(50);
  live.set(jobId, state);
  pending.push({ jobId, repoUrl, commitSha, ref, owner, repo, meta, token, userId });
  pump();
}

function pump() {
  while (running < MAX_CONCURRENT && pending.length > 0) {
    const task = pending.shift();
    running++;
    execute(task).finally(() => {
      running--;
      pump();
    });
  }
}

async function execute({ jobId, repoUrl, commitSha, ref, owner, repo, meta, token, userId }) {
  const state = live.get(jobId);
  const emit = (event, data) => {
    state.events.push({ event, data });
    state.emitter.emit("event", { event, data });
  };

  try {
    await Job.updateOne({ jobId }, { status: "running" });
    const result = await runPipeline({
      owner,
      repo,
      sha: commitSha,
      meta,
      token,
      emit: (event, data) => {
        if (event === "step_start") Job.updateOne({ jobId }, { currentStep: data.step }).catch(() => {});
        emit(event, data);
      },
    });

    const isPrivate = Boolean(meta.private);
    const analysis = await Analysis.create({
      repoUrl,
      commitSha,
      ref,
      private: isPrivate,
      ownerId: isPrivate ? userId : undefined,
      repoMeta: meta,
      ...result,
    });
    await Job.updateOne({ jobId }, { status: "done", analysisId: analysis._id });
    for (const uid of state.watchers.values()) {
      await saveToHistory({ userId: uid, analysis, jobId, ref }).catch((err) =>
        console.error(`[job ${jobId}] could not save to history`, err),
      );
    }
    emit("done", { analysisId: analysis._id.toString() });
  } catch (err) {
    console.error(`[job ${jobId}]`, err);
    const message = describeClaudeError(err);
    await Job.updateOne({ jobId }, { status: "error", error: message }).catch(() => {});
    emit("error", { message });
  } finally {
    state.finished = true;
    // Keep the replay buffer briefly for late subscribers, then rely on MongoDB.
    setTimeout(() => live.delete(jobId), 5 * 60 * 1000).unref();
  }
}
