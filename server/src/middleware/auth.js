import { auth } from "../config.js";
import { AuthSession } from "../models/AuthSession.js";
import { User } from "../models/User.js";
import { decrypt, sha256 } from "../utils/crypto.js";

/** Sets req.user (lean User) when the request carries a valid session cookie. */
export async function attachUser(req, _res, next) {
  try {
    const token = auth.enabled ? req.cookies?.[auth.cookieName] : undefined;
    if (token) {
      const session = await AuthSession.findOne({ tokenHash: sha256(token), expireAt: { $gt: new Date() } }).lean();
      if (session) req.user = await User.findById(session.userId).lean();
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!auth.enabled) return res.status(503).json({ error: "GitHub sign-in is not configured on this server.", code: "auth_disabled" });
  if (!req.user) return res.status(401).json({ error: "Sign in with GitHub first.", code: "auth_required" });
  next();
}

/** The signed-in user's GitHub token, or undefined. */
export function githubToken(user) {
  return user?.tokenEnc ? (decrypt(user.tokenEnc) ?? undefined) : undefined;
}

export const hasPrivateAccess = (user) => Boolean(user?.tokenEnc && user.scopes?.includes("repo"));

/**
 * Runs fn(token) with the user's GitHub token (undefined when signed out). If GitHub says
 * the token is revoked, it is forgotten and fn is retried anonymously, so a revoked token
 * still lets the user work with public repos. fn must check `token` before trusting a
 * private result: the anonymous retry uses the server's GITHUB_TOKEN.
 */
export async function withGithub(req, fn) {
  const token = githubToken(req.user);
  if (!token) return fn(undefined);
  try {
    return await fn(token);
  } catch (err) {
    if (err.code !== "github_auth_invalid") throw err;
    await User.updateOne({ _id: req.user._id }, { $unset: { tokenEnc: 1 }, $set: { scopes: [] } });
    req.user = { ...req.user, tokenEnc: undefined, scopes: [] };
    return fn(undefined);
  }
}
