import mongoose from "mongoose";

// Only a hash of the cookie value is stored, so a database leak can't be replayed as sessions.
const authSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  expireAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export const AuthSession = mongoose.model("AuthSession", authSessionSchema, "auth_sessions");
