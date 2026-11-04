/** Pure helpers for inbound email threading (unit-tested). */

/** Extracts the reply token from "case+<token>@domain" in any recipient header. */
export function findReplyToken(
  addresses: string[],
  localpart: string,
  domain: string,
): string | null {
  const re = new RegExp(`^${escapeRe(localpart)}\\+([^@]+)@${escapeRe(domain)}$`, 'i');
  for (const a of addresses) {
    const m = re.exec(a.trim().toLowerCase());
    if (m) return m[1]!;
  }
  return null;
}

/** Case number in the subject, e.g. "Re: [WD-2026-000123] ..." (lowest-trust fallback). */
export function caseNumberFromSubject(subject: string | undefined): string | null {
  const m = /\[(WD-\d{4}-\d{6})\]/i.exec(subject ?? '');
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Removes quoted history and signatures so only the new reply is stored:
 * stops at "On … wrote:", Outlook "From:/-----Original Message-----" blocks, "> " quotes and "-- " sig.
 */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (
      /^On .+wrote:\s*$/i.test(l) ||
      (/^On .+/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? ''))
    )
      break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^From:\s.+/i.test(l) && /^(Sent|Date):\s/i.test(lines[i + 1] ?? '')) break;
    if (/^_{20,}$/.test(l)) break;
    if (l === '-- ') break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
