import mongoose from "mongoose";
import { TTL_MS } from "../config.js";

const analysisSchema = new mongoose.Schema({
  repoUrl: { type: String, required: true, index: true },
  commitSha: { type: String, required: true },
  // The branch/tag/commit the user asked for when this analysis ran (display only;
  // the cache key is repoUrl + commitSha).
  ref: String,
  // Private-repo analyses are only ever served to the user who ran them.
  private: { type: Boolean, default: false },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  repoMeta: {
    owner: String,
    name: String,
    fullName: String,
    description: String,
    stars: Number,
    language: String,
    defaultBranch: String,
    htmlUrl: String,
  },
  classification: {
    projectType: String,
    primaryLanguage: String,
    framework: String,
    purpose: String,
  },
  overview: String,
  selectedFiles: [{ _id: false, path: String, reason: String }],
  fileSummaries: [
    {
      _id: false,
      path: String,
      purpose: String,
      exports: [String],
      dependsOn: [String],
    },
  ],
  architecture: String,
  layers: [{ _id: false, name: String, files: [String], description: String }],
  readingOrder: [{ _id: false, file: String, reason: String }],
  nonObvious: String,
  suggestedQuestions: [String],
  confusionMap: [{ _id: false, issue: String, detail: String, files: [String] }],
  createdAt: { type: Date, default: Date.now },
  // TTL. Unset (removed) while any user has this analysis in "My analyses".
  expireAt: { type: Date, default: () => new Date(Date.now() + TTL_MS.analysis), index: { expireAfterSeconds: 0 } },
});

analysisSchema.index({ repoUrl: 1, commitSha: 1, private: 1, ownerId: 1 });

export const Analysis = mongoose.model("Analysis", analysisSchema, "analyses");
