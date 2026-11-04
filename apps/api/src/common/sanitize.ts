import sanitizeHtml from 'sanitize-html';

/** Server-side allowlist for rich text (messages, descriptions). Output is safe to render as HTML. */
export function sanitizeRichText(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h3', 'h4', 'hr', 'span'],
    allowedAttributes: { a: ['href', 'title'], span: ['data-mention'], code: ['class'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedClasses: { code: ['language-*'] },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }) },
    disallowedTagsMode: 'escape',
  }).trim();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Plain text → safe HTML. Paragraphs and line breaks are kept; ```fenced``` blocks become
 * <pre><code>, `inline code` becomes <code>. Everything else is escaped. Used for all user input.
 */
export function textToHtml(text: string): string {
  const out: string[] = [];
  const parts = text.replace(/\r\n/g, '\n').split(/^```[a-z0-9-]*\s*$/m);
  parts.forEach((chunk, i) => {
    if (i % 2 === 1) {
      out.push(`<pre><code>${esc(chunk.replace(/^\n|\n$/g, ''))}</code></pre>`);
      return;
    }
    for (const para of chunk.split(/\n{2,}/)) {
      const t = para.trim();
      if (!t) continue;
      out.push(`<p>${esc(t).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>')}</p>`);
    }
  });
  return sanitizeRichText(out.join(''));
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}
