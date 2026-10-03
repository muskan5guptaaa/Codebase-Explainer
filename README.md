# Codebase Explainer

Paste a GitHub repo URL and get a plain-English walkthrough: what the project does, how its pieces connect, which files to read first, and what's likely to confuse you. Then ask follow-up questions in a chat.

- **Any branch, tag or commit**, not just the default branch.
- **Private repos** after signing in with GitHub (the private-repo permission is asked for separately from sign-in).
- **Export** as Markdown, as an `ONBOARDING.md` to commit to the repo, or as a PDF (via the print dialog).
- **Chat with citations**: file paths in answers link to GitHub at the analysed commit, with repo-specific starter questions.
- **My analyses**: signed-in users' analyses and chats are kept until they remove them.

MERN stack + Claude API. Built from the [PRD](https://claude.ai/artifact/P3YS9yA5jXgeDpmehpVoAm).

## Setup

Requirements: Node 22.9+, MongoDB (local or Atlas), an Anthropic API key.

```bash
# 1. Backend
cd server
cp .env.example .env      # then fill in GEMINI_API_KEY (and GITHUB_TOKEN if you have one)
npm install
npm run dev               # http://localhost:5000

# 2. Frontend (second terminal)
cd client
npm install
npm run dev               # http://localhost:5173  (proxies /api to :5000)
```

### GitHub sign-in (optional)

Needed for private repos and "My analyses"; everything else works without it.

1. Create an OAuth App at https://github.com/settings/developers with the callback URL
   `http://localhost:5173/api/auth/github/callback` (the client origin; Vite proxies `/api` to the server, so the session cookie lands on the origin the browser uses).
2. Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` (32+ random characters) in `server/.env`.

In production, serve the client and `/api` from the same origin and set `CLIENT_ORIGIN` to it.

## How it works

```
React (Vite)  ──POST /api/analyze──▶  Express  ──▶ cache check (repoUrl + commit SHA in MongoDB)
     ▲                                   │ miss
     │  SSE /api/analyze/:jobId/stream   ▼
     └────────── step events ◀── in-process job queue ──▶ 5-step Claude pipeline
```

| Step | Model | What it does |
|---|---|---|
| 1. Classify | `claude-haiku-4-5` | Project type, language, framework, purpose, overview, from metadata, top-level tree, README and manifest |
| 2. Select files | `claude-haiku-4-5` | Picks up to 30 key files from a pre-filtered tree (dependencies, build output, lock files, binaries and generated code are removed first) |
| 3. Analyse files | `claude-sonnet-5-5` (effort low) | Per-file summaries in batches of 5, 3 batches in parallel |
| 4. Synthesise | `claude-sonnet-5-5` (effort medium) | Architecture, layers, 5-file reading order, one non-obvious insight |
| 5. Confusion map | `claude-sonnet-5-5` (effort medium) | 3–5 most confusing or surprising things |

Every step uses structured outputs (JSON Schema), so responses are always valid JSON. Each step's output is streamed to the browser as soon as it's ready.

GitHub usage is 3 REST calls per analysis (repo, branch, tree); file contents come from `raw.githubusercontent.com`, which does not count against the API rate limit.

## API

| Method | Route | Description |
|---|---|---|
| POST | `/api/analyze` | `{ url }` → `{ jobId, status, cached }` |
| GET | `/api/analyze/:jobId/stream` | SSE: `steps`, `step_start`, `step_progress`, `step_complete`, `done`, `error` |
| GET | `/api/analyze/:jobId` | `{ job, analysis }` |
| POST | `/api/chat` | `{ jobId, sessionId?, message }` → SSE: `session`, `text`, `done`, `error` |
| GET | `/api/analyze/:jobId/export?format=walkthrough|onboarding` | Markdown download |
| GET | `/api/chat/:jobId/session` | Signed-in user's latest conversation about this analysis |
| GET | `/api/repo-meta?url=` | Repo metadata only, no AI call |
| GET | `/api/repo-meta/refs?url=` | First 100 branches and tags |
| GET | `/api/auth/me` | `{ enabled, user }` |
| GET | `/api/auth/github?private=1&returnTo=` | Starts GitHub OAuth (`read:user`, plus `repo` with `private=1`) |
| POST | `/api/auth/logout` | Ends the session |
| GET | `/api/history?q=&cursor=&limit=` | "My analyses", most recently opened first |
| POST | `/api/history` | `{ jobId }`: save an analysis opened from a link |
| DELETE | `/api/history/:id` | Remove an entry and its chats |

`POST /api/analyze` also takes an optional `ref` (branch, tag or commit SHA); the cache key stays repo + resolved commit SHA. Chat streams a `sources` event (cited files) before `done`.

## Changes from the PRD

- **No BullMQ/Redis.** Jobs run in an in-process queue (2 concurrent) with an event replay buffer. Swap in BullMQ if you deploy more than one server instance.
- **No tiktoken.** It's OpenAI's tokenizer and doesn't match Claude's. Context size is bounded by limits instead: 30 files max, 40k characters per file (truncation is marked explicitly in the prompt), batches of 5.
- **No express-sse.** SSE is written directly. It's ~10 lines and the package is unmaintained.
- **Rate limit counts only cache misses.** Re-opening an already-analysed repo is free.
- **Server-side refusal fallback** is enabled on Sonnet calls (`fallbacks: "default"`), so a false-positive safety decline doesn't fail an analysis.

## Data retention

Unsaved data expires through `expireAt` TTL indexes: `analyses` 7 days · `jobs` (shared links) 24 hours · `chat_sessions` 2 hours after the last message. Anything in a signed-in user's "My analyses" (the analysis, its link and their chats about it) doesn't expire until they remove it. Older databases that used `createdAt` TTL indexes are migrated on startup.

## Private repos

- An analysis of a private repo is served only to the user who ran it: it never enters the shared cache, and its link, export and chat return 404 for anyone else. Removing it from "My analyses" deletes it.
- The repo's source files are sent to the AI model to produce the analysis.
- GitHub tokens are stored AES-256-GCM encrypted (key derived from `SESSION_SECRET`). If GitHub reports a token revoked, it is dropped and the user keeps public-repo access until they sign in again.
- Access is checked when the analysis runs. A user who later loses access to the repo can still open analyses they already saved.
