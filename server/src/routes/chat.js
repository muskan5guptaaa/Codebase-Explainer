import { Router } from "express";
import mongoose from "mongoose";
import { LIMITS, TTL_MS } from "../config.js";
import { Analysis } from "../models/Analysis.js";
import { ChatSession } from "../models/ChatSession.js";
import { UserAnalysis } from "../models/UserAnalysis.js";
import { chatSystem } from "../pipeline/prompts.js";
import { findJobForViewer } from "../services/access.js";
import { extractCitations, knownPaths } from "../services/citations.js";
import { describeClaudeError, streamChat } from "../services/claude.js";

export const chatRouter = Router();

const toClient = (m) => ({ role: m.role, content: m.content, sources: m.sources ?? [] });

// POST /api/chat { jobId, sessionId?, message } — streams the reply as SSE over the POST response:
//   event: session {sessionId} → event: text {text}... → event: sources {sources} → event: done | event: error {message}
chatRouter.post("/", async (req, res, next) => {
  try {
    const { jobId, sessionId, message } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Message is required." });
    if (message.length > 4000) return res.status(400).json({ error: "Message is too long (4,000 characters max)." });

    const job = await findJobForViewer(jobId, req.user);
    if (!job?.analysisId) return res.status(404).json({ error: "Analysis not found or not finished yet." });
    const analysis = await Analysis.findById(job.analysisId).lean();
    if (!analysis) return res.status(404).json({ error: "Analysis has expired. Run it again." });

    const userId = req.user?._id;
    // Signed-in users can only continue their own sessions; anonymous ones only anonymous sessions.
    let session =
      typeof sessionId === "string" && mongoose.isValidObjectId(sessionId)
        ? await ChatSession.findOne({ _id: sessionId, analysisId: analysis._id, userId: userId ?? null })
        : null;
    if (!session) {
      session = new ChatSession({ analysisId: analysis._id, userId, messages: [] });
      // Chats about a saved analysis are kept as long as the analysis is.
      if (userId && (await UserAnalysis.exists({ userId, analysisId: analysis._id }))) session.expireAt = undefined;
    }
    if (session.messages.length >= LIMITS.chatMaxMessagesPerSession) {
      return res.status(400).json({ error: "This conversation is full. Start a new chat to keep going.", code: "chat_full" });
    }
    // Unsaved chats expire after a period of inactivity, not a fixed time after they started.
    if (session.expireAt) session.expireAt = new Date(Date.now() + TTL_MS.chat);

    session.messages.push({ role: "user", content: message.trim() });
    const history = session.messages
      .slice(-LIMITS.chatHistoryMessages)
      .map((m) => ({ role: m.role, content: m.content }));
    // The API requires the first message to be from the user.
    while (history.length && history[0].role !== "user") history.shift();

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("session", { sessionId: session._id.toString() });

    try {
      const { text, tokens } = await streamChat({
        system: chatSystem(analysis),
        messages: history,
        onText: (t) => send("text", { text: t }),
      });
      const sources = extractCitations(text, knownPaths(analysis));
      session.messages.push({ role: "assistant", content: text, sources });
      session.tokensUsed += tokens;
      await session.save();
      send("sources", { sources });
      send("done", {});
    } catch (err) {
      console.error("[chat]", err);
      // Drop the unanswered question so history stays user/assistant alternating.
      session.messages.pop();
      if (session.messages.length) await session.save().catch(() => {});
      send("error", { message: describeClaudeError(err) });
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/:jobId/session — the signed-in user's latest conversation about this analysis.
chatRouter.get("/:jobId/session", async (req, res, next) => {
  try {
    const job = await findJobForViewer(req.params.jobId, req.user);
    if (!job?.analysisId) return res.status(404).json({ error: "Analysis not found or not finished yet." });
    if (!req.user) return res.json({ sessionId: null, messages: [] });

    const session = await ChatSession.findOne({ userId: req.user._id, analysisId: job.analysisId })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ sessionId: session?._id ?? null, messages: (session?.messages ?? []).map(toClient) });
  } catch (err) {
    next(err);
  }
});
