import mongoose from "mongoose";
import { TTL_MS } from "../config.js";

const chatSessionSchema = new mongoose.Schema(
  {
    analysisId: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true },
    // Set for signed-in users; their sessions can be resumed and, once the analysis is
    // saved to "My analyses", never expire.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    messages: [
      {
        _id: false,
        role: { type: String, enum: ["user", "assistant"] },
        content: String,
        // Repo files the answer cites (known paths only), for the GitHub links under the reply.
        sources: [String],
        ts: { type: Date, default: Date.now },
      },
    ],
    tokensUsed: { type: Number, default: 0 },
    expireAt: { type: Date, default: () => new Date(Date.now() + TTL_MS.chat), index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true },
);

chatSessionSchema.index({ userId: 1, analysisId: 1, updatedAt: -1 });

export const ChatSession = mongoose.model("ChatSession", chatSessionSchema, "chat_sessions");
