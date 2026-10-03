import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  githubId: { type: Number, required: true, unique: true },
  login: { type: String, required: true },
  name: String,
  avatarUrl: String,
  // AES-GCM encrypted GitHub OAuth token. Absent once GitHub reports it revoked.
  tokenEnc: String,
  scopes: [String],
  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: Date.now },
});

export const User = mongoose.model("User", userSchema, "users");
