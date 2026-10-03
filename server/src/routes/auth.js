import { Router } from "express";
import { auth, config } from "../config.js";
import { hasPrivateAccess } from "../middleware/auth.js";
import { AuthSession } from "../models/AuthSession.js";
import { User } from "../models/User.js";
import { encrypt, randomToken, safeEqual, sha256 } from "../utils/crypto.js";

export const authRouter = Router();

const STATE_COOKIE = "ce_oauth";
const secure = config.isProd || auth.callbackUrl.startsWith("https://");

/** Only same-site relative paths, so the callback can't be used as an open redirect. */
function safeReturnTo(value) {
  return typeof value === "string" && /^\/(?![/\\])[^\s]*$/.test(value) && value.length <= 2000 ? value : "/";
}

function backToClient(res, returnTo, error) {
  const url = new URL(safeReturnTo(returnTo), config.clientOrigin);
  if (error) url.searchParams.set("auth_error", error);
  res.redirect(url.toString());
}

// GET /api/auth/me — who is signed in, and whether sign-in is available at all.
authRouter.get("/me", (req, res) => {
  const u = req.user;
  res.json({
    enabled: auth.enabled,
    user: u
      ? { id: u._id, login: u.login, name: u.name, avatarUrl: u.avatarUrl, privateAccess: hasPrivateAccess(u) }
      : null,
  });
});

// GET /api/auth/github?private=1&returnTo=/path — starts the OAuth flow.
authRouter.get("/github", (req, res) => {
  if (!auth.enabled) return res.status(503).json({ error: "GitHub sign-in is not configured on this server." });
  const state = randomToken();
  const returnTo = safeReturnTo(req.query.returnTo);
  res.cookie(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 10 * 60 * 1000,
    path: "/api/auth",
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", auth.clientId);
  url.searchParams.set("redirect_uri", auth.callbackUrl);
  url.searchParams.set("scope", req.query.private === "1" ? auth.scopePrivate : auth.scopeBasic);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// GET /api/auth/github/callback — GitHub redirects here with ?code&state.
authRouter.get("/github/callback", async (req, res) => {
  let saved = {};
  try {
    saved = JSON.parse(req.cookies?.[STATE_COOKIE] ?? "{}");
  } catch {}
  res.clearCookie(STATE_COOKIE, { path: "/api/auth" });
  const returnTo = safeReturnTo(saved.returnTo);

  if (!auth.enabled) return backToClient(res, returnTo, "GitHub sign-in is not configured on this server.");
  if (req.query.error) {
    return backToClient(res, returnTo, req.query.error === "access_denied" ? "Sign-in was cancelled." : "GitHub sign-in failed.");
  }
  if (!saved.state || typeof req.query.state !== "string" || !safeEqual(saved.state, req.query.state)) {
    return backToClient(res, returnTo, "Sign-in expired or was started in another tab. Please try again.");
  }
  if (typeof req.query.code !== "string") return backToClient(res, returnTo, "GitHub sign-in failed.");

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        code: req.query.code,
        redirect_uri: auth.callbackUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || "No access token");

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!userRes.ok) throw new Error(`GitHub /user returned ${userRes.status}`);
    const gh = await userRes.json();

    // GitHub returns every scope this user has granted the app, not just the ones requested now.
    const scopes = String(tokenData.scope ?? "").split(/[,\s]+/).filter(Boolean);
    const user = await User.findOneAndUpdate(
      { githubId: gh.id },
      {
        $set: {
          login: gh.login,
          name: gh.name ?? "",
          avatarUrl: gh.avatar_url,
          tokenEnc: encrypt(tokenData.access_token),
          scopes,
          lastLoginAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true },
    );

    const sessionToken = randomToken();
    const maxAge = auth.sessionDays * 24 * 60 * 60 * 1000;
    await AuthSession.create({ tokenHash: sha256(sessionToken), userId: user._id, expireAt: new Date(Date.now() + maxAge) });
    res.cookie(auth.cookieName, sessionToken, { httpOnly: true, sameSite: "lax", secure, maxAge, path: "/" });
    backToClient(res, returnTo);
  } catch (err) {
    console.error("[auth] GitHub callback failed:", err.message);
    backToClient(res, returnTo, "GitHub sign-in failed. Please try again.");
  }
});

// POST /api/auth/logout
authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[auth.cookieName];
    if (token) await AuthSession.deleteOne({ tokenHash: sha256(token) });
    res.clearCookie(auth.cookieName, { path: "/" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
