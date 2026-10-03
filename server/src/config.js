const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/codebase-explainer",
  githubToken: process.env.GITHUB_TOKEN || undefined,
  clientOrigin,
  analyzeLimitPerHour: Number(process.env.ANALYZE_LIMIT_PER_HOUR) || 5,
  isProd: process.env.NODE_ENV === "production",
};

// GitHub sign-in. Needs a GitHub OAuth App (https://github.com/settings/developers) and a
// SESSION_SECRET, which also derives the key that encrypts stored GitHub tokens.
// The callback goes through the client origin by default so the session cookie is set
// on the same origin the browser uses (Vite proxies /api to the server in dev).
export const auth = {
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  callbackUrl: process.env.GITHUB_CALLBACK_URL || `${clientOrigin}/api/auth/github/callback`,
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionDays: 30,
  cookieName: "ce_session",
  // Public-repo sign-in only needs identity; "repo" is requested separately for private repos.
  scopeBasic: "read:user",
  scopePrivate: "read:user repo",
};
auth.enabled = Boolean(auth.clientId && auth.clientSecret && auth.sessionSecret);

// Models named in the PRD: Haiku for the cheap classification/selection steps,
// Sonnet for per-file analysis, synthesis, the confusion map, and chat.
export const MODELS = {
  // The 2.5 models aren't available to API keys created after their retirement.
  fast: process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite",
  main: process.env.GEMINI_MODEL_MAIN || "gemini-3.8-flash",
};

export const LIMITS = {
  maxSelectedFiles: 30,
  batchSize: 5,
  batchConcurrency: 2,
  maxCharsPerFile: 40_000, // ~10k tokens
  maxTreePathsForSelection: 1500,
  chatHistoryMessages: 20,
  chatMaxMessagesPerSession: 200,
  maxRefsListed: 100,
  maxSuggestedQuestions: 6,
};

// Retention for data that nobody has saved to "My analyses". Saved data has no expiry.
export const TTL_MS = {
  analysis: 7 * 24 * 60 * 60 * 1000,
  job: 24 * 60 * 60 * 1000,
  chat: 2 * 60 * 60 * 1000,
};
