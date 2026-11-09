import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { committedFingerprints, scanFingerprints } from '@wd/brand-lint';
import type { AssistantAnswer } from '@wd/contracts';
import { sql } from 'kysely';
import { logger } from '../../common/logger.js';
import type { Principal } from '../../common/principal.js';
import type { AppConfig } from '../../config.js';
import type { Database, Tx } from '../../db/database.js';
import { CONFIG, DB } from '../../tokens.js';
import { audienceFor } from '../kb/kb.service.js';

export interface Passage {
  n: number;
  slug: string;
  title: string;
  text: string;
}

const STOP = new Set(
  'the and for with that this from have what when where which how why can does doing into your you our are was were will would should could about there their them then than also just only been being any all not but use using get got my me i we is it its of to in on at by an a or be do as if so no yes please help need want'.split(
    ' ',
  ),
);
const MAX_ARTICLES = 4;
const MAX_PASSAGES = 3;
const CHUNK = 700;

/** Words worth searching for: lower-case letters and digits only, no stop words. */
export const keywords = (q: string) =>
  [...new Set(q.toLowerCase().match(/[a-z0-9][a-z0-9.-]{1,30}/g) ?? [])]
    .map((w) => w.replace(/[.-]+$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 12);

/** Markdown to readable plain text, keeping commands on their own lines. */
export const plain = (md: string) =>
  md
    .replace(/```[a-z]*\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Splits an article into passages along its headings and paragraphs. */
export function chunks(md: string): string[] {
  const parts = md
    .split(/\n(?=#{1,4}\s)|\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + '\n\n' + p).length > CHUNK && cur) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

const score = (text: string, words: string[]) => {
  const t = text.toLowerCase();
  return words.reduce((s, w) => s + (t.includes(w) ? (w.length > 4 ? 2 : 1) : 0), 0);
};

const brandClean = (s: string) => scanFingerprints(s, committedFingerprints()).length === 0;

/**
 * Answers support questions only from published knowledge base articles the asker may read.
 * Default mode quotes the best passages; with an Anthropic key it writes an answer from the same
 * passages. Either way the answer cites its sources and points to opening a case when unsure.
 */
@Injectable()
export class AssistantService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  private run<T>(p: Principal | undefined, fn: (tx: Tx) => Promise<T>) {
    return p ? this.db.withTenant(p, fn) : this.db.withAnonymous(fn);
  }

  async retrieve(p: Principal | undefined, question: string): Promise<Passage[]> {
    const words = keywords(question);
    if (!words.length) return [];
    const tsq = words.join(' | ');
    const aud = audienceFor(p);
    const rows = await this.run(p, (tx) =>
      sql<{ slug: string; title: string; body_md: string }>`
        SELECT a.slug, a.title, v.body_md
          FROM kb_article a
          JOIN kb_version v ON v.article_id = a.id AND v.version = a.current_version
         WHERE a.state = 'published' AND a.visibility = ANY(${aud}::text[])
           AND (a.search_vec @@ to_tsquery('english', ${tsq}) OR a.search_vec @@ to_tsquery('simple', ${tsq}))
         ORDER BY ts_rank_cd(a.search_vec, to_tsquery('english', ${tsq}), 32) * 2
                + ts_rank_cd(a.search_vec, to_tsquery('simple', ${tsq}), 32) DESC,
                  a.helpful - a.not_helpful DESC
         LIMIT ${MAX_ARTICLES}`.execute(tx),
    );
    const scored = rows.rows.flatMap((r, rank) =>
      chunks(r.body_md).map((c) => ({
        slug: r.slug,
        title: r.title,
        text: plain(c),
        s: score(`${r.title} ${c}`, words) + (MAX_ARTICLES - rank) * 0.5,
      })),
    );
    const picked: Passage[] = [];
    const seen = new Map<string, number>();
    for (const c of scored.sort((a, b) => b.s - a.s)) {
      if (picked.length >= MAX_PASSAGES || c.s < 1.5) break;
      if (!seen.has(c.slug)) seen.set(c.slug, seen.size + 1);
      picked.push({ n: seen.get(c.slug)!, slug: c.slug, title: c.title, text: c.text });
    }
    return picked;
  }

  private extractive(passages: Passage[]): string {
    const lead = passages[0]!;
    const trim = (t: string, n: number) =>
      t.length > n ? `${t.slice(0, t.lastIndexOf(' ', n))}…` : t;
    const lines = [`From "${lead.title}" [${lead.n}]:`, trim(lead.text, 600)];
    const other = passages.find((x) => x.slug !== lead.slug);
    if (other) lines.push('', `Also see "${other.title}" [${other.n}].`);
    lines.push('', 'If this does not solve it, open a case and an engineer will help.');
    return lines.join('\n');
  }

  private async generative(question: string, passages: Passage[]): Promise<string | null> {
    if (!this.cfg.ANTHROPIC_API_KEY) return null;
    const context = passages.map((x) => `[${x.n}] ${x.title}\n${x.text}`).join('\n\n---\n\n');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'x-api-key': this.cfg.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.cfg.ASSISTANT_MODEL,
        max_tokens: 600,
        system:
          'You are the WatchDog Support help assistant for WatchDog networking products (a brand of Apollo Infoways Pvt. Ltd.). ' +
          'Answer only from the numbered knowledge base excerpts provided. Cite every fact with its number, like [1]. ' +
          'If the excerpts do not answer the question, say so plainly and suggest opening a support case. ' +
          'Never name other vendors or products, never guess commands that are not in the excerpts, and never ask for passwords. ' +
          'Use short plain sentences and numbered steps for procedures. Plain text only, no markdown.',
        messages: [
          {
            role: 'user',
            content: `Knowledge base excerpts:\n\n${context}\n\nQuestion: ${question}`,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`assistant model HTTP ${r.status}`);
    const b = (await r.json()) as { content?: { type: string; text?: string }[] };
    return b.content?.find((c) => c.type === 'text')?.text?.trim() || null;
  }

  async ask(p: Principal | undefined, question: string): Promise<AssistantAnswer> {
    const passages = await this.retrieve(p, question);
    const sources = [
      ...new Map(passages.map((x) => [x.slug, { slug: x.slug, title: x.title, n: x.n }])).values(),
    ]
      .sort((a, b) => a.n - b.n)
      .map(({ slug, title }) => ({ slug, title }));
    let answer: string;
    let mode: AssistantAnswer['mode'] = 'extractive';
    if (!passages.length) {
      answer =
        'I could not find a WatchDog article that answers this. Try different words, such as the model name or the message you see, or open a case and an engineer will help.';
    } else {
      answer = this.extractive(passages);
      if (this.cfg.ASSISTANT_MODE === 'anthropic') {
        try {
          const g = await this.generative(question, passages);
          // A generated answer must be on-brand and cite at least one source; otherwise quote instead.
          if (g && brandClean(g) && /\[\d\]/.test(g)) {
            answer = g;
            mode = 'generative';
          }
        } catch (err) {
          logger.warn({ err }, 'assistant model failed; quoting articles instead');
        }
      }
    }
    // No RETURNING: only staff may read questions back (RLS), so the id is made here.
    const id = randomUUID();
    await this.run(p, (tx) =>
      tx
        .insertInto('assistant_query')
        .values({
          id,
          org_id: p?.orgId ?? null,
          user_id: p?.userId ?? null,
          question,
          sources: sources.map((s) => s.slug),
          found: passages.length > 0,
          mode,
        })
        .execute(),
    );
    return { id, answer, found: passages.length > 0, sources, mode };
  }

  async feedback(p: Principal | undefined, id: string, helpful: boolean) {
    const r = await this.run(p, (tx) =>
      sql<{
        ok: boolean | null;
      }>`SELECT wd.assistant_feedback(${id}::uuid, ${helpful}) AS ok`.execute(tx),
    );
    return Boolean(r.rows[0]?.ok);
  }

  /** Recent questions nobody's article answered, for knowledge base editors. */
  async gaps(p: Principal) {
    return this.db.withTenant(p, (tx) =>
      tx
        .selectFrom('assistant_query')
        .select(['question', 'created_at', 'helpful', 'found'])
        .where((eb) => eb.or([eb('found', '=', false), eb('helpful', '=', false)]))
        .where('created_at', '>', sql<Date>`now() - interval '90 days'`)
        .orderBy('created_at', 'desc')
        .limit(100)
        .execute(),
    );
  }
}
