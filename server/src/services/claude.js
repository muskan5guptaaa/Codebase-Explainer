// Google Gemini backend. File/export names are kept from the original Claude
// implementation so the pipeline and chat route work unchanged.
import { MODELS } from "../config.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class ClaudeError extends Error {}

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ClaudeError("Gemini API key is not configured. Set GEMINI_API_KEY in server/.env.");
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gemini(model, method, body, query = "") {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/${model}:${method}${query}`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      if (attempt < 3) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new ClaudeError("Could not reach the Gemini API.");
    }
    if (res.ok) return res;

    const detail = await res.text().catch(() => "");
    let msg = detail;
    try {
      msg = JSON.parse(detail).error?.message ?? detail;
    } catch {}
    // A used-up daily quota won't recover by retrying (it resets at midnight Pacific time).
    if (res.status === 429 && /PerDay/i.test(detail)) {
      console.error(`[gemini] daily quota exhausted for ${model}: ${msg}`);
      throw new ClaudeError(
        `Gemini's daily free-tier quota for ${model} is used up (it resets at midnight Pacific time). ` +
          "Use a different model via GEMINI_MODEL_MAIN / GEMINI_MODEL_FAST in server/.env, use another API key, or enable billing.",
      );
    }
    // Per-minute rate limits and overloads: wait and retry.
    if ((res.status === 429 || res.status === 503) && attempt < 6) {
      const hinted = /retry in ([\d.]+)s/i.exec(msg)?.[1];
      await sleep(Math.min(hinted ? Number(hinted) * 1000 + 500 : 5000 * attempt, 65_000));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ClaudeError("Gemini API key is missing or invalid.");
    if (res.status === 429) {
      console.error(`[gemini] rate limited on ${model} after ${attempt} attempts: ${msg}`);
      throw new ClaudeError(
        `Gemini API rate limit hit for ${model} (free-tier quota). Wait a minute and retry, or enable billing. ` +
          `Google said: ${msg.split("\n")[0]}`,
      );
    }
    throw new ClaudeError(`Gemini API error ${res.status}: ${msg}`);
  }
}

function checkCandidate(data) {
  const c = data.candidates?.[0];
  if (!c) {
    const reason = data.promptFeedback?.blockReason;
    throw new ClaudeError(reason ? `The model declined this request (${reason}).` : "The model returned no response.");
  }
  if (c.finishReason === "MAX_TOKENS") throw new ClaudeError("The model's output was cut off (max tokens reached).");
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(c.finishReason)) {
    throw new ClaudeError(`The model declined this request (${c.finishReason}).`);
  }
  return c;
}

const textOfCandidate = (c) => (c.content?.parts ?? []).map((p) => p.text ?? "").join("");

/** One structured-output call. `schema` is a JSON Schema; the result is parsed JSON. */
export async function generateJson({ model, system, prompt, schema, maxTokens = 16000 }) {
  const res = await gemini(model, "generateContent", {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      maxOutputTokens: maxTokens,
    },
  });
  const c = checkCandidate(await res.json());
  try {
    return JSON.parse(textOfCandidate(c));
  } catch {
    throw new ClaudeError("The model returned malformed JSON.");
  }
}

/** Streams a chat reply. Calls onText for each delta; resolves to { text, tokens }. */
export async function streamChat({ system, messages, onText }) {
  const res = await gemini(
    MODELS.main,
    "streamGenerateContent",
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: 8000 },
    },
    "?alt=sse",
  );

  let text = "";
  let tokens = 0;
  let buffer = "";
  const decoder = new TextDecoder();

  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const data = JSON.parse(line.slice(5).trim());
    if (data.usageMetadata?.totalTokenCount) tokens = data.usageMetadata.totalTokenCount;
    const c = data.candidates?.[0];
    if (!c && data.promptFeedback?.blockReason) checkCandidate(data);
    const delta = c ? textOfCandidate(c) : "";
    if (delta) {
      text += delta;
      onText(delta);
    }
  };

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handle);
  }
  if (buffer) handle(buffer);
  if (!text) throw new ClaudeError("The model returned no response.");
  return { text, tokens };
}

/** Maps errors to a user-facing message. */
export function describeClaudeError(err) {
  return err?.message || "Unknown error";
}
