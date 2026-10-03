import { useState } from "react";
import Menu, { MenuItem } from "./Menu.jsx";

async function fetchMarkdown(jobId, format) {
  const res = await fetch(`/api/analyze/${encodeURIComponent(jobId)}/export?format=${format}`, { credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "walkthrough.md";
  return { name, text: await res.text() };
}

async function download(jobId, format) {
  const { name, text } = await fetchMarkdown(jobId, format);
  saveFile(name, text);
}

function saveFile(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportMenu({ jobId }) {
  const [status, setStatus] = useState(null); // { kind: "ok" | "error", text }

  async function run(fn, okText) {
    setStatus(null);
    try {
      await fn();
      if (okText) setStatus({ kind: "ok", text: okText });
    } catch (err) {
      setStatus({ kind: "error", text: err.message || "Export failed." });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Menu
        label="Export ▾"
        buttonClassName="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-accent hover:text-accent"
      >
        <MenuItem
          hint="Standalone file, links pinned to this commit"
          onClick={() => run(() => download(jobId, "walkthrough"))}
        >
          Download Markdown
        </MenuItem>
        <MenuItem
          hint="To commit at the repo root; links are relative"
          onClick={() => run(() => download(jobId, "onboarding"))}
        >
          Download ONBOARDING.md
        </MenuItem>
        <MenuItem
          onClick={() =>
            run(async () => {
              const { text } = await fetchMarkdown(jobId, "walkthrough");
              await navigator.clipboard.writeText(text);
            }, "Copied to clipboard")
          }
        >
          Copy as Markdown
        </MenuItem>
        <MenuItem hint='Opens the print dialog; choose "Save as PDF"' onClick={() => window.print()}>
          Save as PDF
        </MenuItem>
      </Menu>
      {status && (
        <span role="status" className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-slate-500"}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}
