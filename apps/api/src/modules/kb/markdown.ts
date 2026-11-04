import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/** Markdown → sanitised HTML. Tables and code blocks allowed; no images, scripts, iframes or raw HTML events. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { gfm: true, breaks: false, async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      'h2',
      'h3',
      'h4',
      'p',
      'br',
      'hr',
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
      'kbd',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
      pre: ['tabindex'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedClasses: { code: ['language-*'] },
    // <pre> scrolls horizontally on small screens, so it must be keyboard-focusable (WCAG 2.1.1).
    transformTags: {
      h1: 'h2',
      pre: sanitizeHtml.simpleTransform('pre', { tabindex: '0' }),
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
    },
  });
}
