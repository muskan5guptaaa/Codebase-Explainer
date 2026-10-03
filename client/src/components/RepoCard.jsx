export default function RepoCard({ meta, sha, refName }) {
  const isPrivate = meta.private;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <a href={meta.htmlUrl} target="_blank" rel="noreferrer" className="font-semibold text-slate-900 hover:text-accent">
            {meta.fullName}
          </a>
          {isPrivate && (
            <span className="rounded border border-slate-300 px-1.5 text-[11px] font-medium text-slate-600">Private</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {meta.language && <span>{meta.language}</span>}
          <span>★ {Number(meta.stars ?? 0).toLocaleString()}</span>
          {refName && <span className="max-w-48 truncate font-mono" title={refName}>{refName}</span>}
          {sha &&
            (meta.htmlUrl ? (
              <a href={`${meta.htmlUrl}/commit/${sha}`} target="_blank" rel="noreferrer" className="font-mono hover:text-accent">
                @{sha.slice(0, 7)}
              </a>
            ) : (
              <span className="font-mono">@{sha.slice(0, 7)}</span>
            ))}
        </div>
      </div>
      {meta.description && <p className="mt-1 text-sm text-slate-600">{meta.description}</p>}
    </div>
  );
}
