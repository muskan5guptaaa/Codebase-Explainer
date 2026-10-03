import mongoose from "mongoose";
import { config, TTL_MS } from "./config.js";
import { Analysis } from "./models/Analysis.js";
import { AuthSession } from "./models/AuthSession.js";
import { ChatSession } from "./models/ChatSession.js";
import { Job } from "./models/Job.js";
import { User } from "./models/User.js";
import { UserAnalysis } from "./models/UserAnalysis.js";

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);

  // Earlier versions expired documents via a TTL index on createdAt. Expiry now lives in
  // expireAt so saved analyses can opt out of it. Backfill expireAt on old documents
  // (only while the legacy index still exists, i.e. once), then drop the legacy index.
  await migrateLegacyTtl(Analysis, TTL_MS.analysis);
  await migrateLegacyTtl(Job, TTL_MS.job);
  await migrateLegacyTtl(ChatSession, TTL_MS.chat);
  for (const model of [Analysis, Job, ChatSession, User, AuthSession, UserAnalysis]) await model.syncIndexes();
}

async function migrateLegacyTtl(Model, ttlMs) {
  const indexes = await Model.collection.indexes().catch(() => []); // throws if the collection doesn't exist yet
  if (!indexes.some((i) => i.key?.createdAt && i.expireAfterSeconds != null)) return;
  const { modifiedCount } = await Model.updateMany({ expireAt: { $exists: false } }, [
    { $set: { expireAt: { $add: [{ $ifNull: ["$createdAt", "$$NOW"] }, ttlMs] } } },
  ]);
  console.log(`Migrated ${modifiedCount} ${Model.collection.collectionName} documents to expireAt TTL.`);
}
