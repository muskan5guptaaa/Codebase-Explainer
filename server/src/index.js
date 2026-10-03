import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { auth, config } from "./config.js";
import { connectDb } from "./db.js";
import { attachUser } from "./middleware/auth.js";
import { analyzeRouter } from "./routes/analyze.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { historyRouter } from "./routes/history.js";
import { repoMetaRouter } from "./routes/repoMeta.js";

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

const hourly = (limit) => rateLimit({ windowMs: 60 * 60 * 1000, limit });
// Only sending messages counts against the chat limit; loading a conversation doesn't.
const chatLimiter = hourly(40);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api", attachUser);
app.use("/api/auth", hourly(120), authRouter);
app.use("/api/repo-meta", hourly(120), repoMetaRouter);
app.use("/api/analyze", analyzeRouter);
app.use("/api/chat", (req, res, next) => (req.method === "POST" ? chatLimiter(req, res, next) : next()), chatRouter);
app.use("/api/history", hourly(600), historyRouter);

app.use((err, _req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message, code: err.code });
});

if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠ GEMINI_API_KEY is not set. Cached analyses will load, but new analyses and chat will fail.");
}
if (!auth.enabled) {
  const missing = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET"].filter((k) => !process.env[k]);
  console.warn(`ℹ GitHub sign-in is off (missing ${missing.join(", ")}). Private repos and "My analyses" need it.`);
} else if (auth.sessionSecret.length < 32) {
  console.warn("⚠ SESSION_SECRET is short. Use at least 32 random characters (it also encrypts stored GitHub tokens).");
}

connectDb()
  .then(() => app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`)))
  .catch((err) => {
    console.error(`Could not connect to MongoDB at ${config.mongoUri}\n`, err.message);
    process.exit(1);
  });
