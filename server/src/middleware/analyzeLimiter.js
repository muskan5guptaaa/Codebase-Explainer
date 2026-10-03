import { config } from "../config.js";

// Counts only analyses that actually run the AI pipeline; cache hits are free.
// In-memory, so it resets on restart; swap for Redis if the app runs on more than one instance.
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map(); // ip -> timestamps

export function allowNewAnalysis(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= config.analyzeLimitPerHour) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) {
    const recent = ts.filter((t) => now - t < WINDOW_MS);
    if (recent.length) hits.set(ip, recent);
    else hits.delete(ip);
  }
}, WINDOW_MS).unref();
