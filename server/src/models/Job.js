import mongoose from "mongoose";
import { TTL_MS } from "../config.js";

const jobSchema = new mongoose.Schema({
  jobId: { type: String, required: true, unique: true, index: true },
  repoUrl: { type: String, required: true },
  commitSha: String,
  ref: String,
  // Private jobs can only be read by `userId`.
  private: { type: Boolean, default: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["queued", "running", "done", "error"],
    default: "queued",
  },
  currentStep: { type: Number, default: 0 },
  analysisId: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis" },
  cached: { type: Boolean, default: false },
  error: String,
  createdAt: { type: Date, default: Date.now },
  // TTL. Unset while the job is referenced by a "My analyses" entry.
  expireAt: { type: Date, default: () => new Date(Date.now() + TTL_MS.job), index: { expireAfterSeconds: 0 } },
});

export const Job = mongoose.model("Job", jobSchema, "jobs");
