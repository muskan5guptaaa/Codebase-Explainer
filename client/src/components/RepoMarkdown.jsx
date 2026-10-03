import { useMemo } from "react";
import Markdown from "react-markdown";

/**
 * Markdown from the model, with inline-code file paths (`src/app.js`) turned into GitHub
 * links. Only paths in `known` are linked, so a made-up path never becomes a dead link.
 */
export default function RepoMarkdown({ children, known, fileUrl }) {
  const components = useMemo(
    () => ({
      code({ node: _node, className, children: content, ...props }) {
        const text = String(content);
        if (!className && known?.has(text) && fileUrl) {
          return (
            <a href={fileUrl(text)} target="_blank" rel="noreferrer" className="no-underline" title={`Open ${text} on GitHub`}>
              <code {...props}>{text}</code>
            </a>
          );
        }
        return (
          <code className={className} {...props}>
            {content}
          </code>
        );
      },
    }),
    [known, fileUrl],
  );
  return <Markdown components={components}>{children ?? ""}</Markdown>;
}
