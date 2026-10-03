import mongoose from "mongoose";

// "My analyses": one entry per (user, analysis). Repo fields are denormalised so the
// list page never has to load the full analyses. Saving an entry stops the underlying
// analysis, job and chats from expiring.
const userAnalysisSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  analysisId: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true },
  jobId: { type: String, required: true },
  repoUrl: String,
  fullName: String,
  htmlUrl: String,
  description: String,
  language: String,
  stars: Number,
  private: { type: Boolean, default: false },
  ref: String,
  commitSha: String,
  projectType: String,
  purpose: String,
  createdAt: { type: Date, default: Date.now },
  lastOpenedAt: { type: Date, default: Date.now },
});

userAnalysisSchema.index({ userId: 1, analysisId: 1 }, { unique: true });
userAnalysisSchema.index({ userId: 1, lastOpenedAt: -1, _id: -1 });
userAnalysisSchema.index({ analysisId: 1 });
userAnalysisSchema.index({ jobId: 1 });

export const UserAnalysis = mongoose.model("UserAnalysis", userAnalysisSchema, "user_analyses");
