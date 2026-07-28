'use client';

import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export function safeMarkdownUrl(url: string): string {
  if (url.startsWith('user:')) return url;
  const transformed = defaultUrlTransform(url);
  return transformed || '#';
}

const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'user'],
  },
};

export default function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="task-markdown text-sm leading-6 text-slate-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        urlTransform={safeMarkdownUrl}
        components={{
          a({ href, children }) {
            if (href?.startsWith('user:')) {
              return <span role="link" aria-label={`Mention ${String(children)}`} className="rounded bg-blue-400/15 px-1 text-blue-200">@{children}</span>;
            }
            return <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-300 underline">{children}</a>;
          },
          code({ children }) {
            return <code className="rounded bg-black/30 px-1 py-0.5 text-cyan-200">{children}</code>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
