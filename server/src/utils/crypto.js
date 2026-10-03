import crypto from "node:crypto";
import { auth } from "../config.js";

// AES-256-GCM for GitHub tokens at rest. The key is derived from SESSION_SECRET.
let cachedKey;
function key() {
  cachedKey ??= Buffer.from(crypto.hkdfSync("sha256", auth.sessionSecret, "", "codebase-explainer/github-token", 32));
  return cachedKey;
}

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

/** Returns the plaintext, or null if the payload is malformed or the key changed. */
export function decrypt(payload) {
  try {
    const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const randomToken = () => crypto.randomBytes(32).toString("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
