import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  AdvisoryDraftRequest,
  AdvisoryEditorView,
  AdvisorySeverity,
  AdvisorySubscriptionBody,
  AdvisorySummary,
  AdvisoryView,
} from '@wd/contracts';
import type { Database, Tx } from '../../db/database.js';
import { DB } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { assertBrandClean } from '../../common/brand-guard.js';
import { conflict, notFound, unprocessable } from '../../common/errors.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import { renderMarkdown } from '../kb/markdown.js';

export const SEVERITY_RANK: Record<AdvisorySeverity, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

type Row = {
  id: string;
  wd_id: string;
  title: string;
  summary: string;
  severity: AdvisorySeverity;
  cvss_score: string | null;
  cve_ids: string[];
  status: AdvisorySummary['status'];
  revision: number;
  published_at: Date | null;
  updated_at: Date;
};

const run = <T>(db: Database, p: Principal | undefined, fn: (tx: Tx) => Promise<T>) =>
  p ? db.withTenant(p, fn) : db.withAnonymous(fn);

/**
 * WatchDog security advisories (PSIRT). Public once published; drafts and PSIRT notes are staff-only
 * (RLS). Only WatchDog product names, CVE IDs and CVSS appear in public text, enforced by the
 * brand guard on save.
 */
@Injectable()
export class AdvisoriesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private base(tx: Tx) {
    return tx
      .selectFrom('advisory as a')
      .select([
        'a.id',
        'a.wd_id',
        'a.title',
        'a.summary',
        'a.severity',
        'a.cvss_score',
        'a.cve_ids',
        'a.status',
        'a.revision',
        'a.published_at',
        'a.updated_at',
      ]);
  }

  private async products(tx: Tx, ids: string[]) {
    if (!ids.length) return [];
    return tx
      .selectFrom('advisory_affected as x')
      .innerJoin('product as p', 'p.id', 'x.product_id')
      .innerJoin('product_family as f', 'f.id', 'p.family_id')
      .select([
        'x.advisory_id',
        'p.id as product_id',
        'p.sku',
        'p.model_name',
        'f.key as family_key',
        'x.affected_versions',
        'x.fixed_version',
      ])
      .where('x.advisory_id', 'in', ids)
      .orderBy('p.sku')
      .execute();
  }

  private summary(
    r: Row,
    prods: Awaited<ReturnType<AdvisoriesService['products']>>,
  ): AdvisorySummary {
    return {
      wdId: r.wd_id,
      title: r.title,
      summary: r.summary,
      severity: r.severity,
      cvssScore: r.cvss_score === null ? null : Number(r.cvss_score),
      cveIds: r.cve_ids,
      status: r.status,
      revision: r.revision,
      publishedAt: r.published_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
      products: prods
        .filter((x) => x.advisory_id === r.id)
        .map((x) => ({ sku: x.sku, modelName: x.model_name, familyKey: x.family_key })),
    };
  }

  async list(
    p: Principal | undefined,
    q: { severity?: AdvisorySeverity; family?: string; q?: string },
  ): Promise<{ items: AdvisorySummary[] }> {
    return run(this.db, p, async (tx) => {
      let s = this.base(tx)
        .where('a.status', 'in', ['published', 'withdrawn'])
        .orderBy('a.published_at', 'desc')
        .limit(200);
      if (q.severity) s = s.where('a.severity', '=', q.severity);
      if (q.family)
        s = s.where((eb) =>
          eb.exists(
            eb
              .selectFrom('advisory_affected as x')
              .innerJoin('product as p', 'p.id', 'x.product_id')
              .innerJoin('product_family as f', 'f.id', 'p.family_id')
              .select(sql`1`.as('one'))
              .whereRef('x.advisory_id', '=', 'a.id')
              .where('f.key', '=', q.family!),
          ),
        );
      if (q.q) {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        s = s.where((eb) =>
          eb.or([
            eb('a.title', 'ilike', like),
            eb('a.wd_id', 'ilike', like),
            eb(sql<string>`array_to_string(a.cve_ids, ' ')`, 'ilike', like),
          ]),
        );
      }
      const rows = (await s.execute()) as Row[];
      const prods = await this.products(
        tx,
        rows.map((r) => r.id),
      );
      return { items: rows.map((r) => this.summary(r, prods)) };
    });
  }

  async get(p: Principal | undefined, wdId: string): Promise<AdvisoryView> {
    return run(this.db, p, async (tx) => {
      let s = this.base(tx)
        .select(['a.cvss_vector', 'a.body_html', 'a.workaround_html', 'a.revision_note'])
        .where('a.wd_id', '=', wdId);
      if (!p?.isInternal) s = s.where('a.status', 'in', ['published', 'withdrawn']);
      const r = await s.executeTakeFirst();
      if (!r) throw notFound('Advisory');
      const prods = await this.products(tx, [r.id]);
      let yourDevices: number | null = null;
      if (p && !p.isInternal && prods.length) {
        const n = await tx
          .selectFrom('asset')
          .select(sql<string>`count(*)`.as('n'))
          .where(
            'product_id',
            'in',
            prods.map((x) => x.product_id),
          )
          .where('retired_at', 'is', null)
          .where('org_id', 'in', [p.orgId, ...p.delegatedOrgIds])
          .executeTakeFirst();
        yourDevices = Number(n?.n ?? 0);
      }
      return {
        ...this.summary(r as Row, prods),
        cvssVector: r.cvss_vector,
        bodyHtml: r.body_html,
        workaroundHtml: r.workaround_html,
        revisionNote: r.revision_note,
        affected: prods.map((x) => ({
          sku: x.sku,
          modelName: x.model_name,
          affectedVersions: x.affected_versions,
          fixedVersion: x.fixed_version,
        })),
        yourDevices,
      };
    });
  }

  // ---------------------------------------------------------------- RSS

  async rss(publicWebUrl: string): Promise<string> {
    const { items } = await this.list(undefined, {});
    const x = (s: string) =>
      s.replace(
        /[<>&'"]/g,
        (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
      );
    const entries = items
      .slice(0, 50)
      .map(
        (a) => `    <item>
      <title>${x(`${a.wdId}: ${a.title}${a.status === 'withdrawn' ? ' (withdrawn)' : ''}`)}</title>
      <link>${x(`${publicWebUrl}/advisories/${a.wdId}`)}</link>
      <guid isPermaLink="false">${x(`${a.wdId}#r${a.revision}`)}</guid>
      <pubDate>${new Date(a.updatedAt).toUTCString()}</pubDate>
      <category>${x(a.severity)}</category>
      <description>${x(`${a.severity.toUpperCase()}${a.cvssScore !== null ? ` (CVSS ${a.cvssScore})` : ''}. ${a.summary}${a.cveIds.length ? ` ${a.cveIds.join(', ')}.` : ''}`)}</description>
    </item>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>WatchDog security advisories</title>
    <link>${x(`${publicWebUrl}/advisories`)}</link>
    <atom:link href="${x(`${publicWebUrl}/api/v1/advisories/rss.xml`)}" rel="self" type="application/rss+xml"/>
    <description>Security advisories for WatchDog products</description>
    <language>en-in</language>
${entries}
  </channel>
</rss>
`;
  }

  // ---------------------------------------------------------------- subscriptions

  async getSubscription(p: Principal) {
    return this.db.withTenant(p, async (tx) => {
      const s = await tx
        .selectFrom('advisory_subscription')
        .selectAll()
        .where('user_id', '=', p.userId)
        .executeTakeFirst();
      if (!s)
        return { subscribed: false, familyKeys: [] as string[], minSeverity: 'medium' as const };
      const fams = s.family_ids.length
        ? await tx
            .selectFrom('product_family')
            .select('key')
            .where('id', 'in', s.family_ids)
            .execute()
        : [];
      return { subscribed: true, familyKeys: fams.map((f) => f.key), minSeverity: s.min_severity };
    });
  }

  async subscribe(p: Principal, b: AdvisorySubscriptionBody) {
    await this.db.withTenant(p, async (tx) => {
      const fams = b.familyKeys.length
        ? await tx
            .selectFrom('product_family')
            .select('id')
            .where('key', 'in', b.familyKeys)
            .execute()
        : [];
      if (fams.length !== b.familyKeys.length)
        throw unprocessable('familyKeys', 'Unknown product family');
      await tx
        .insertInto('advisory_subscription')
        .values({
          user_id: p.userId,
          family_ids: fams.map((f) => f.id),
          min_severity: b.minSeverity,
        })
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet({
            family_ids: fams.map((f) => f.id),
            min_severity: b.minSeverity,
            updated_at: new Date(),
          }),
        )
        .execute();
    });
    return this.getSubscription(p);
  }

  async unsubscribe(p: Principal) {
    await this.db.withTenant(p, (tx) =>
      tx.deleteFrom('advisory_subscription').where('user_id', '=', p.userId).execute(),
    );
  }

  // ---------------------------------------------------------------- staff authoring

  async adminList(p: Principal) {
    return this.db.withTenant(p, async (tx) => {
      const rows = (await this.base(tx)
        .orderBy('a.updated_at', 'desc')
        .limit(300)
        .execute()) as Row[];
      const prods = await this.products(
        tx,
        rows.map((r) => r.id),
      );
      return { items: rows.map((r) => this.summary(r, prods)) };
    });
  }

  async editorGet(p: Principal, wdId: string): Promise<AdvisoryEditorView> {
    const view = await this.get(p, wdId);
    return this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('advisory as a')
        .leftJoin('advisory_internal as i', 'i.advisory_id', 'a.id')
        .select(['a.id', 'a.body_md', 'a.workaround_md', 'i.notes'])
        .where('a.wd_id', '=', wdId)
        .executeTakeFirstOrThrow();
      return {
        ...view,
        id: a.id,
        bodyMd: a.body_md,
        workaroundMd: a.workaround_md,
        internalNotes: a.notes ?? '',
      };
    });
  }

  private async resolveAffected(tx: Tx, b: AdvisoryDraftRequest) {
    const skus = b.affected.map((x) => x.sku);
    if (new Set(skus).size !== skus.length)
      throw unprocessable('affected', 'Each model may be listed once');
    const prods = await tx
      .selectFrom('product')
      .select(['id', 'sku'])
      .where('sku', 'in', skus)
      .execute();
    const missing = skus.filter((s) => !prods.some((p) => p.sku === s));
    if (missing.length) throw unprocessable('affected', `Unknown models: ${missing.join(', ')}`);
    return b.affected.map((x) => ({
      product_id: prods.find((p) => p.sku === x.sku)!.id,
      affected_versions: x.affectedVersions,
      fixed_version: x.fixedVersion || null,
    }));
  }

  private guard(b: AdvisoryDraftRequest) {
    // Public text only; PSIRT internal notes may reference upstream sources.
    assertBrandClean({
      title: b.title,
      summary: b.summary,
      details: b.bodyMd,
      workaround: b.workaroundMd,
      'affected versions': b.affected
        .map((x) => `${x.affectedVersions} ${x.fixedVersion ?? ''}`)
        .join(' '),
      'revision note': b.revisionNote,
    });
  }

  async create(
    p: Principal,
    ctx: RequestContext,
    b: AdvisoryDraftRequest,
  ): Promise<AdvisoryEditorView> {
    this.guard(b);
    const wdId = await this.db.withTenant(p, async (tx) => {
      const affected = await this.resolveAffected(tx, b);
      const a = await tx
        .insertInto('advisory')
        .values({
          title: b.title,
          summary: b.summary,
          severity: b.severity,
          cvss_score: b.cvssScore ?? null,
          cvss_vector: b.cvssVector ?? null,
          cve_ids: b.cveIds,
          body_md: b.bodyMd,
          body_html: renderMarkdown(b.bodyMd),
          workaround_md: b.workaroundMd,
          workaround_html: renderMarkdown(b.workaroundMd),
          created_by: p.userId,
        })
        .returning(['id', 'wd_id'])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('advisory_affected')
        .values(affected.map((x) => ({ ...x, advisory_id: a.id })))
        .execute();
      await tx
        .insertInto('advisory_internal')
        .values({ advisory_id: a.id, notes: b.internalNotes })
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'advisory.create', orgId: null, targetType: 'advisory', targetId: a.id },
      );
      return a.wd_id;
    });
    return this.editorGet(p, wdId);
  }

  /** Editing a published advisory creates a new public revision and needs a change note. */
  async update(
    p: Principal,
    ctx: RequestContext,
    wdId: string,
    b: AdvisoryDraftRequest,
  ): Promise<AdvisoryEditorView> {
    this.guard(b);
    await this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('advisory')
        .select(['id', 'status'])
        .where('wd_id', '=', wdId)
        .forUpdate()
        .executeTakeFirst();
      if (!a) throw notFound('Advisory');
      if (a.status === 'withdrawn')
        throw conflict('withdrawn', 'A withdrawn advisory cannot be edited');
      const published = a.status === 'published';
      if (published && !b.revisionNote)
        throw unprocessable(
          'revisionNote',
          'Say what changed: readers see this with the new revision',
        );
      const affected = await this.resolveAffected(tx, b);
      await tx
        .updateTable('advisory')
        .set({
          title: b.title,
          summary: b.summary,
          severity: b.severity,
          cvss_score: b.cvssScore ?? null,
          cvss_vector: b.cvssVector ?? null,
          cve_ids: b.cveIds,
          body_md: b.bodyMd,
          body_html: renderMarkdown(b.bodyMd),
          workaround_md: b.workaroundMd,
          workaround_html: renderMarkdown(b.workaroundMd),
          ...(published
            ? { revision: sql`revision + 1`, revision_note: b.revisionNote ?? null }
            : {}),
        })
        .where('id', '=', a.id)
        .execute();
      await tx.deleteFrom('advisory_affected').where('advisory_id', '=', a.id).execute();
      await tx
        .insertInto('advisory_affected')
        .values(affected.map((x) => ({ ...x, advisory_id: a.id })))
        .execute();
      await tx
        .insertInto('advisory_internal')
        .values({ advisory_id: a.id, notes: b.internalNotes })
        .onConflict((oc) => oc.column('advisory_id').doUpdateSet({ notes: b.internalNotes }))
        .execute();
      if (published) await emit(tx, 'advisory.published', null, { advisoryId: a.id, update: true });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'advisory.update', orgId: null, targetType: 'advisory', targetId: a.id },
      );
    });
    return this.editorGet(p, wdId);
  }

  async publish(p: Principal, ctx: RequestContext, wdId: string) {
    await this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('advisory')
        .select(['id', 'status'])
        .where('wd_id', '=', wdId)
        .forUpdate()
        .executeTakeFirst();
      if (!a) throw notFound('Advisory');
      if (a.status !== 'draft') throw conflict('not-draft', 'Only drafts can be published');
      await tx
        .updateTable('advisory')
        .set({ status: 'published', revision: 1, published_at: new Date() })
        .where('id', '=', a.id)
        .execute();
      await emit(tx, 'advisory.published', null, { advisoryId: a.id, update: false });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'advisory.publish', orgId: null, targetType: 'advisory', targetId: a.id },
      );
    });
    return this.editorGet(p, wdId);
  }

  async withdraw(p: Principal, ctx: RequestContext, wdId: string, reason: string) {
    await this.db.withTenant(p, async (tx) => {
      const a = await tx
        .selectFrom('advisory')
        .select(['id', 'status'])
        .where('wd_id', '=', wdId)
        .forUpdate()
        .executeTakeFirst();
      if (!a) throw notFound('Advisory');
      if (a.status !== 'published')
        throw conflict('not-published', 'Only published advisories can be withdrawn');
      await tx
        .updateTable('advisory')
        .set({ status: 'withdrawn', revision: sql`revision + 1`, revision_note: reason })
        .where('id', '=', a.id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'advisory.withdraw', orgId: null, targetType: 'advisory', targetId: a.id },
      );
    });
    return this.editorGet(p, wdId);
  }
}
