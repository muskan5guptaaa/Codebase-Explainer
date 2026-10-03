import axios from "axios";

export const api = axios.create({ baseURL: "/api", withCredentials: true });

export const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-_.]+\/[A-Za-z0-9-_.]+\/?(?:\.git)?(?:[/?#].*)?$/i;

export function errorMessage(err) {
  return err?.response?.data?.error || err?.message || "Something went wrong.";
}

/** Machine-readable error code from the API (e.g. "not_found_or_private"), if any. */
export function errorCode(err) {
  return err?.response?.data?.code ?? err?.code;
}

/** Parses an SSE stream from a fetch() Response body (used for POST /api/chat). */
export async function* readSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}

/** Every file path that appears anywhere in a (possibly partial) analysis. Mirrors the server's knownPaths. */
export function knownPaths(a) {
  const paths = new Set();
  a?.selectedFiles?.forEach((f) => paths.add(f.path));
  a?.fileSummaries?.forEach((f) => paths.add(f.path));
  a?.layers?.forEach((l) => l.files?.forEach((p) => paths.add(p)));
  a?.readingOrder?.forEach((r) => paths.add(r.file));
  a?.confusionMap?.forEach((c) => c.files?.forEach((p) => paths.add(p)));
  paths.delete(undefined);
  paths.delete("");
  return paths;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(date) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
