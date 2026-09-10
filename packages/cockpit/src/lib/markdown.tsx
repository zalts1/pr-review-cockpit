import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'sup',
  'sub',
  'kbd',
  'details',
  'summary',
];

// No class: a body must not be able to borrow the cockpit's own styles.
const ALLOWED_ATTR = ['href', 'title', 'align'];

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HTML_COMMENT = /^\s*<!--[\s\S]*?-->\s*$/;
const PASSTHROUGH_HTML = /^<\/?(sup|sub|kbd|br|details|summary)\b[^>]*>$/i;
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

const ALERT_LABEL: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

// Bots wrap their sections in HTML comments, and GitHub bodies use a few inline
// tags; those pass to the sanitiser. Any other raw HTML is shown as the text it
// was written as, never parsed as markup.
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    html(token) {
      if (HTML_COMMENT.test(token.raw)) return '';
      if (PASSTHROUGH_HTML.test(token.raw.trim())) return token.raw;
      return escapeHtml(token.raw);
    },
    blockquote({ tokens }) {
      const first = tokens[0];
      if (first?.type === 'paragraph') {
        const match = ALERT.exec(first.text);
        if (match && match[1] !== undefined) {
          const label = ALERT_LABEL[match[1].toUpperCase()] ?? match[1];
          const rest = this.parser.parse(tokens.slice(1));
          const lead = first.text.replace(ALERT, '').trim();
          const leadHtml = lead ? `<p>${marked.parseInline(lead, { async: false })}</p>` : '';
          return `<blockquote><p><strong>${label}</strong></p>${leadHtml}${rest}</blockquote>`;
        }
      }
      return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
    },
  },
});

const HLJS_CLASS = /^hljs-[a-z-]+$/;

let hooked = false;

function installHooks(): void {
  if (hooked) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      return;
    }
    if (node.tagName !== 'SPAN' || !node.hasAttribute('class')) return;
    const kept = (node.getAttribute('class') ?? '').split(/\s+/).filter((c) => HLJS_CLASS.test(c));
    if (kept.length === 0) node.removeAttribute('class');
    else node.setAttribute('class', kept.join(' '));
  });
  hooked = true;
}

function sanitize(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_ATTR: ['target'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitised HTML for one highlighted line of code. Only highlight.js's own spans survive:
 * every other tag is unwrapped and every other class removed, so a diff line can never
 * reach the page as markup of its own.
 */
export function sanitizeCodeHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['span'],
    ALLOWED_ATTR: ['class'],
    ALLOW_DATA_ATTR: false,
  });
}

/** Sanitised HTML for one markdown body: block level, with paragraphs and lists. */
export function renderMarkdown(text: string): string {
  return sanitize(marked.parse(text, { async: false }));
}

/** Sanitised HTML for markdown that has to stay on one line, such as a bullet or a table cell. */
export function renderMarkdownInline(text: string): string {
  return sanitize(marked.parseInline(text, { async: false }));
}

interface Props {
  text: string;
  className?: string;
}

export function Markdown({ text, className }: Props) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={className === undefined ? 'md' : `md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function MarkdownInline({ text, className }: Props) {
  const html = useMemo(() => renderMarkdownInline(text), [text]);
  return (
    <span
      className={className === undefined ? 'md md-inline' : `md md-inline ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
