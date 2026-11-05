import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  KbArticleView,
  KbDraftRequest,
  KbEditorArticle,
  KbHit,
  KbSearchResult,
  KbType,
} from '@wd/contracts';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { has, type Principal, type RequestContext } from '../../common/principal.js';
import { htmlToText } from '../../common/sanitize.js';
import { renderMarkdown } from './markdown.js';

export { renderMarkdown };

export type Audience = Array<'public' | 'registered' | 'partner' | 'internal'>;

/** Which visibility levels a caller may read. Anonymous visitors see public articles only. */
export function audienceFor(p: Principal | undefined): Audience {
  if (!p) return ['public'];
  if (has(p, 'kb:read:internal')) return ['public', 'registered', 'partner', 'internal'];
  if (p.orgType === 'partner') return ['public', 'registered', 'partner'];
  return ['public', 'registered'];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** ts_headline output uses \u0001/\u0002 as markers so the text can be escaped before adding <mark>. */
const highlight = (s: string) =>
  esc(s).split('\u0001').join('<mark>').split('\u0002').join('</mark>');

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'article'
  );
}

@Injectable()
export class KbService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private run<T>(p: Principal | undefined, fn: (tx: Tx) => Promise<T>) {
    return p ? this.db.withTenant(p, fn) : this.db.withAnonymous(fn);
  }

  // ------------------------------------------------------------------ search
  async search(
    p: Principal | undefined,
    q: { q: string; type?: KbType; family?: string; page: number; limit: number },
  ): Promise<KbSearchResult> {
    const started = performance.now();
    const aud = audienceFor(p);
    const term = q.q.trim();
    return this.run(p, async (tx) => {
      await sql`SET LOCAL pg_trgm.word_similarity_threshold = 0.45`.execute(tx);
      const match = term
        ? sql`(a.search_vec @@ websearch_to_tsquery('english', ${term}) OR a.search_vec @@ websearch_to_tsquery('simple', ${term}) OR ${term} <% a.title)`
        : sql`true`;
      const base = sql`a.state = 'published' AND a.visibility = ANY(${aud}::text[]) AND ${match}`;
      const typeF = q.type ? sql`AND a.type = ${q.type}` : sql``;
      const famF = q.family ? sql`AND f.key = ${q.family}` : sql``;
      const score = term
        ? sql`(ts_rank_cd(a.search_vec, websearch_to_tsquery('english', ${term}), 32) * 2
              + ts_rank_cd(a.search_vec, websearch_to_tsquery('simple', ${term}), 32)
              + word_similarity(${term}, a.title))`
        : sql`0::float8`;
      const snippet = term
        ? sql<string>`ts_headline('english', coalesce(a.summary, ''), websearch_to_tsquery('english', ${term}), 'StartSel=' || chr(1) || ',StopSel=' || chr(2) || ',MaxWords=40,MinWords=15,HighlightAll=true')`
        : sql<string>`coalesce(a.summary, '')`;

      const rows = await sql<{
        slug: string;
        title: string;
        summary: string;
        type: KbType;
        fkey: string | null;
        fname: string | null;
        published_at: Date | null;
        snippet: string;
        total: string;
      }>`
        SELECT a.slug, a.title, a.summary, a.type, f.key AS fkey, f.name AS fname, a.published_at, ${snippet} AS snippet, count(*) OVER () AS total
        FROM kb_article a LEFT JOIN product_family f ON f.id = a.family_id
        WHERE ${base} ${typeF} ${famF}
        ORDER BY ${score} DESC, a.helpful - a.not_helpful DESC, a.published_at DESC NULLS LAST
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`.execute(tx);

      // Facets over the full match set (each facet ignores its own filter).
      const facets = await sql<{ type: string | null; fkey: string | null; n: string }>`
        SELECT a.type, f.key AS fkey, count(*) AS n
        FROM kb_article a LEFT JOIN product_family f ON f.id = a.family_id
        WHERE ${base}
        GROUP BY GROUPING SETS ((a.type), (f.key))`.execute(tx);

      let didYouMean: string | null = null;
      if (term && rows.rows.length === 0) {
        const s = await sql<{ title: string }>`
          SELECT title FROM kb_article a
          WHERE a.state = 'published' AND a.visibility = ANY(${aud}::text[]) AND similarity(a.title, ${term}) > 0.15
          ORDER BY similarity(a.title, ${term}) DESC LIMIT 1`.execute(tx);
        didYouMean = s.rows[0]?.title ?? null;
      }
      const items: KbHit[] = rows.rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        type: r.type,
        familyKey: r.fkey,
        familyName: r.fname,
        publishedAt: r.published_at?.toISOString() ?? null,
        snippet: highlight(r.snippet),
      }));
      const typeFacet: Record<string, number> = {};
      const famFacet: Record<string, number> = {};
      for (const f of facets.rows) {
        if (f.type) typeFacet[f.type] = Number(f.n);
        else if (f.fkey) famFacet[f.fkey] = Number(f.n);
      }
      return {
        items,
        total: Number(rows.rows[0]?.total ?? 0),
        page: q.page,
        facets: { type: typeFacet, family: famFacet },
        didYouMean,
        tookMs: Math.round(performance.now() - started),
      };
    });
  }

  /** Lightweight suggestions while a customer types a case subject (deflection). */
  async suggest(
    p: Principal | undefined,
    term: string,
  ): Promise<Array<{ slug: string; title: string; type: KbType }>> {
    if (term.trim().length < 4) return [];
    const r = await this.search(p, { q: term, page: 1, limit: 5 });
    return r.items.map((i) => ({ slug: i.slug, title: i.title, type: i.type }));
  }

  // ------------------------------------------------------------------ reading
  async article(p: Principal | undefined, slug: string): Promise<KbArticleView> {
    const aud = audienceFor(p);
    return this.run(p, async (tx) => {
      const a = await tx
        .selectFrom('kb_article as a')
        .leftJoin('product_family as f', 'f.id', 'a.family_id')
        .innerJoin('kb_version as v', (j) =>
          j.onRef('v.article_id', '=', 'a.id').onRef('v.version', '=', 'a.published_version'),
        )
        .select([
          'a.id',
          'a.slug',
          'a.type',
          'a.visibility',
          'a.state',
          'a.firmware_versions',
          'a.published_at',
          'a.updated_at',
          'a.helpful',
          'a.not_helpful',
          'a.family_id',
          'a.published_version',
          'v.title',
          'v.summary',
          'v.body_md',
          'f.key as fkey',
          'f.name as fname',
        ])
        .where('a.slug', '=', slug)
        .where('a.published_version', 'is not', null)
        .where('a.state', '!=', 'archived')
        .where('a.visibility', 'in', aud)
        .executeTakeFirst();
      // Same answer for "does not exist" and "not visible to you" (no existence oracle for internal KBs).
      if (!a) throw notFound('Article');
      await tx
        .updateTable('kb_article')
        .set({ views: sql`views + 1` })
        .where('id', '=', a.id)
        .execute();
      const products = await tx
        .selectFrom('kb_article_product as ap')
        .innerJoin('product as pr', 'pr.id', 'ap.product_id')
        .select(['pr.sku', 'pr.model_name'])
        .where('ap.article_id', '=', a.id)
        .orderBy('pr.sku')
        .execute();
      const related = await tx
        .selectFrom('kb_article')
        .select(['slug', 'title', 'type'])
        .where('state', '=', 'published')
        .where('visibility', 'in', aud)
        .where('id', '!=', a.id)
        .where((eb) =>
          a.family_id
            ? eb.or([eb('family_id', '=', a.family_id), eb('type', '=', a.type)])
            : eb('type', '=', a.type),
        )
        .orderBy(sql`(family_id = ${a.family_id ?? null}::uuid)`, 'desc')
        .orderBy('helpful', 'desc')
        .limit(4)
        .execute();
      return {
        id: a.id,
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        type: a.type as KbType,
        visibility: a.visibility as KbArticleView['visibility'],
        state: a.state as KbArticleView['state'],
        family: a.fkey ? { key: a.fkey, name: a.fname! } : null,
        products: products.map((x) => ({ sku: x.sku, modelName: x.model_name })),
        firmwareVersions: a.firmware_versions,
        bodyHtml: renderMarkdown(a.body_md),
        version: a.published_version!,
        publishedAt: a.published_at?.toISOString() ?? null,
        updatedAt: a.updated_at.toISOString(),
        helpful: a.helpful,
        notHelpful: a.not_helpful,
        related: related.map((r) => ({
          slug: r.slug,
          title: r.title ?? '',
          type: r.type as KbType,
        })),
      };
    });
  }

  async feedback(
    p: Principal | undefined,
    slug: string,
    helpful: boolean,
    comment?: string,
  ): Promise<void> {
    const aud = audienceFor(p);
    await this.run(p, async (tx) => {
      const a = await tx
        .selectFrom('kb_article')
        .select('id')
        .where('slug', '=', slug)
        .where('state', '=', 'published')
        .where('visibility', 'in', aud)
        .executeTakeFirst();
      if (!a) throw notFound('Article');
      await tx
        .insertInto('kb_feedback')
        .values({ article_id: a.id, user_id: p?.userId ?? null, helpful, comment: comment ?? null })
        .execute();
      await tx
        .updateTable('kb_article')
        .set(helpful ? { helpful: sql`helpful + 1` } : { not_helpful: sql`not_helpful + 1` })
        .where('id', '=', a.id)
        .execute();
    });
  }

  // ------------------------------------------------------------------ editing workflow
  async editorList(p: Principal, state?: string) {
    return this.db.withTenant(p, async (tx) => {
      let q = tx
        .selectFrom('kb_article as a')
        .innerJoin('kb_version as v', (j) =>
          j.onRef('v.article_id', '=', 'a.id').onRef('v.version', '=', 'a.current_version'),
        )
        .innerJoin('app_user as u', 'u.id', 'v.author_id')
        .select([
          'a.id',
          'a.slug',
          'v.title',
          'a.type',
          'a.visibility',
          'a.state',
          'a.current_version',
          'a.published_version',
          'a.updated_at',
          'u.display_name',
        ])
        .orderBy('a.updated_at', 'desc')
        .limit(200);
      if (state) q = q.where('a.state', '=', state);
      const rows = await q.execute();
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        type: r.type as KbType,
        visibility: r.visibility as KbArticleView['visibility'],
        state: r.state as KbArticleView['state'],
        currentVersion: r.current_version,
        publishedVersion: r.published_version,
        updatedAt: r.updated_at.toISOString(),
        authorName: r.display_name,
      }));
    });
  }

  async editorGet(p: Principal, id: string): Promise<KbEditorArticle> {
    return this.db.withTenant(p, (tx) => this.loadEditor(tx, id));
  }

  private async loadEditor(tx: Tx, id: string): Promise<KbEditorArticle> {
    const a = await tx
      .selectFrom('kb_article as a')
      .innerJoin('kb_version as v', (j) =>
        j.onRef('v.article_id', '=', 'a.id').onRef('v.version', '=', 'a.current_version'),
      )
      .innerJoin('app_user as u', 'u.id', 'v.author_id')
      .leftJoin('product_family as f', 'f.id', 'a.family_id')
      .leftJoin('support_case as c', 'c.id', 'a.source_case_id')
      .select([
        'a.id',
        'a.slug',
        'a.type',
        'a.visibility',
        'a.state',
        'a.current_version',
        'a.published_version',
        'a.updated_at',
        'a.firmware_versions',
        'v.title',
        'v.summary',
        'v.body_md',
        'u.display_name',
        'f.key as fkey',
        'c.number as case_number',
      ])
      .where('a.id', '=', id)
      .executeTakeFirst();
    if (!a) throw notFound('Article');
    const skus = await tx
      .selectFrom('kb_article_product as ap')
      .innerJoin('product as pr', 'pr.id', 'ap.product_id')
      .select('pr.sku')
      .where('ap.article_id', '=', id)
      .execute();
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      type: a.type as KbType,
      visibility: a.visibility as KbArticleView['visibility'],
      state: a.state as KbArticleView['state'],
      currentVersion: a.current_version,
      publishedVersion: a.published_version,
      updatedAt: a.updated_at.toISOString(),
      authorName: a.display_name,
      summary: a.summary,
      bodyMd: a.body_md,
      familyKey: a.fkey,
      productSkus: skus.map((s) => s.sku),
      firmwareVersions: a.firmware_versions,
      previewHtml: renderMarkdown(a.body_md),
      sourceCaseNumber: a.case_number,
    };
  }

  async create(
    p: Principal,
    ctx: RequestContext,
    d: KbDraftRequest,
    sourceCaseId: string | null = null,
  ): Promise<KbEditorArticle> {
    return this.db.withTenant(p, async (tx) => {
      const familyId = await this.familyId(tx, d.familyKey);
      let slug = slugify(d.title);
      for (
        let i = 2;
        await tx.selectFrom('kb_article').select('id').where('slug', '=', slug).executeTakeFirst();
        i++
      )
        slug = `${slugify(d.title)}-${i}`;
      const a = await tx
        .insertInto('kb_article')
        .values({
          slug,
          type: d.type,
          visibility: d.visibility,
          family_id: familyId,
          firmware_versions: d.firmwareVersions,
          created_by: p.userId,
          source_case_id: sourceCaseId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('kb_version')
        .values({
          article_id: a.id,
          version: 1,
          title: d.title,
          summary: d.summary,
          body_md: d.bodyMd,
          author_id: p.userId,
          change_note: d.changeNote ?? 'Created',
        })
        .execute();
      await this.setProducts(tx, a.id, d.productSkus);
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'kb.create', orgId: null, targetType: 'kb_article', targetId: a.id },
      );
      return this.loadEditor(tx, a.id);
    });
  }

  /** Saves a new immutable version. A published article stays live on its published version until republished. */
  async update(
    p: Principal,
    ctx: RequestContext,
    id: string,
    d: KbDraftRequest,
  ): Promise<KbEditorArticle> {
    return this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('kb_article')
        .select(['id', 'current_version', 'state'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!a) throw notFound('Article');
      if (a.state === 'archived') throw conflict('archived', 'Archived articles cannot be edited');
      const version = a.current_version + 1;
      await tx
        .insertInto('kb_version')
        .values({
          article_id: id,
          version,
          title: d.title,
          summary: d.summary,
          body_md: d.bodyMd,
          author_id: p.userId,
          change_note: d.changeNote ?? null,
        })
        .execute();
      await tx
        .updateTable('kb_article')
        .set({
          current_version: version,
          state: 'draft',
          type: d.type,
          visibility: d.visibility,
          family_id: await this.familyId(tx, d.familyKey),
          firmware_versions: d.firmwareVersions,
        })
        .where('id', '=', id)
        .execute();
      await this.setProducts(tx, id, d.productSkus);
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'kb.edit',
          orgId: null,
          targetType: 'kb_article',
          targetId: id,
          diff: { version },
        },
      );
      return this.loadEditor(tx, id);
    });
  }

  async submit(p: Principal, ctx: RequestContext, id: string): Promise<KbEditorArticle> {
    return this.transitionState(p, ctx, id, ['draft'], 'review', 'kb.submit');
  }

  /** Publishes the current version: search document is rebuilt from it. Requires kb:publish. */
  async publish(p: Principal, ctx: RequestContext, id: string): Promise<KbEditorArticle> {
    if (!has(p, 'kb:publish'))
      throw forbidden('Only content editors and support managers can publish');
    return this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('kb_article')
        .select(['id', 'current_version', 'state', 'firmware_versions'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!a) throw notFound('Article');
      if (a.state === 'archived')
        throw conflict('archived', 'Archived articles cannot be published');
      const v = await tx
        .selectFrom('kb_version')
        .selectAll()
        .where('article_id', '=', id)
        .where('version', '=', a.current_version)
        .executeTakeFirstOrThrow();
      if (!v.summary.trim()) throw unprocessable('summary', 'Add a summary before publishing');
      assertBrandClean({ title: v.title, summary: v.summary, body: v.body_md });
      await tx
        .updateTable('kb_version')
        .set({ reviewer_id: p.userId })
        .where('article_id', '=', id)
        .where('version', '=', v.version)
        .execute();
      await tx
        .updateTable('kb_article')
        .set({
          state: 'published',
          published_version: v.version,
          published_at: new Date(),
          title: v.title,
          summary: v.summary,
          search_vec: sql`wd.kb_document(${v.title}, ${v.summary}, ${htmlToText(renderMarkdown(v.body_md))}, ${a.firmware_versions}::text[])`,
        } as never)
        .where('id', '=', id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'kb.publish',
          orgId: null,
          targetType: 'kb_article',
          targetId: id,
          diff: { version: v.version },
        },
      );
      return this.loadEditor(tx, id);
    });
  }

  async archive(p: Principal, ctx: RequestContext, id: string): Promise<KbEditorArticle> {
    if (!has(p, 'kb:publish')) throw forbidden();
    return this.transitionState(
      p,
      ctx,
      id,
      ['draft', 'review', 'published'],
      'archived',
      'kb.archive',
    );
  }

  private async transitionState(
    p: Principal,
    ctx: RequestContext,
    id: string,
    from: string[],
    to: string,
    action: string,
  ) {
    return this.db.withTenant(p, async (tx) => {
      const r = await tx
        .updateTable('kb_article')
        .set({ state: to })
        .where('id', '=', id)
        .where('state', 'in', from)
        .executeTakeFirst();
      if (!r.numUpdatedRows) {
        const exists = await tx
          .selectFrom('kb_article')
          .select('state')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!exists) throw notFound('Article');
        throw conflict('state', `An article in state "${exists.state}" cannot move to "${to}"`);
      }
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action, orgId: null, targetType: 'kb_article', targetId: id },
      );
      return this.loadEditor(tx, id);
    });
  }

  /**
   * Drafts an article from a resolved case. Customer-identifying details may be in the case text,
   * so the draft is INTERNAL and must be edited and published by a content editor.
   */
  async draftFromCase(
    p: Principal,
    ctx: RequestContext,
    caseRef: string,
  ): Promise<KbEditorArticle> {
    const src = await this.db.withTenant(p, async (tx) => {
      const c = await tx
        .selectFrom('support_case as c')
        .leftJoin('asset as a', 'a.id', 'c.asset_id')
        .leftJoin('product as pr', 'pr.id', 'a.product_id')
        .leftJoin('product_family as f', 'f.id', 'pr.family_id')
        .select([
          'c.id',
          'c.number',
          'c.subject',
          'c.status',
          'c.category',
          'c.description_html',
          'c.software_version',
          'pr.sku',
          'f.key as fkey',
        ])
        .where(
          /^WD-/i.test(caseRef) ? 'c.number' : 'c.id',
          '=',
          caseRef.toUpperCase().startsWith('WD-') ? caseRef.toUpperCase() : caseRef,
        )
        .executeTakeFirst();
      if (!c) throw notFound('Case');
      if (c.status !== 'resolved' && c.status !== 'closed')
        throw conflict('not-resolved', 'Create articles from resolved cases');
      const replies = await tx
        .selectFrom('case_message')
        .select('body_html')
        .where('case_id', '=', c.id)
        .where('visibility', '=', 'public')
        .where('author_is_staff', '=', true)
        .orderBy('created_at')
        .execute();
      return { c, replies };
    });
    const body = [
      '## Symptoms',
      '',
      htmlToText(src.c.description_html),
      '',
      '## Resolution',
      '',
      ...src.replies.map((r) => htmlToText(r.body_html)),
      '',
      '> Review before publishing: remove customer names, IP addresses, hostnames and serial numbers.',
    ].join('\n');
    return this.create(
      p,
      ctx,
      {
        title:
          src.c.subject.length >= 8 ? src.c.subject : `${src.c.subject} (from ${src.c.number})`,
        summary: '',
        bodyMd: body,
        type: src.c.category === 'documentation' ? 'faq' : 'troubleshooting',
        visibility: 'internal',
        familyKey: src.c.fkey,
        productSkus: src.c.sku ? [src.c.sku] : [],
        firmwareVersions: src.c.software_version ? [src.c.software_version] : [],
        changeNote: `Drafted from case ${src.c.number}`,
      },
      src.c.id,
    );
  }

  private async familyId(tx: Tx, key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    const f = await tx
      .selectFrom('product_family')
      .select('id')
      .where('key', '=', key)
      .executeTakeFirst();
    if (!f) throw unprocessable('family', 'Unknown product family');
    return f.id;
  }

  private async setProducts(tx: Tx, articleId: string, skus: string[]) {
    await tx.deleteFrom('kb_article_product').where('article_id', '=', articleId).execute();
    if (!skus.length) return;
    const prods = await tx
      .selectFrom('product')
      .select(['id', 'sku'])
      .where('sku', 'in', skus)
      .execute();
    if (prods.length !== new Set(skus).size)
      throw unprocessable('products', 'One or more product SKUs are unknown');
    await tx
      .insertInto('kb_article_product')
      .values(prods.map((pr) => ({ article_id: articleId, product_id: pr.id })))
      .execute();
  }
}
