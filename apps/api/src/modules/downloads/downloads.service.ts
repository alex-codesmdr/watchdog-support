import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, type Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { DownloadLink, ReleaseDraftRequest, ReleaseView } from '@wd/contracts';
import type { AppConfig } from '../../config.js';
import type { Database, Tx } from '../../db/database.js';
import { AV_SCANNER, CONFIG, DB, OBJECT_STORE } from '../../tokens.js';
import { audit } from '../../common/audit.js';
import { conflict, notFound, ProblemError, unprocessable } from '../../common/errors.js';
import { logger } from '../../common/logger.js';
import { emit } from '../../common/outbox.js';
import type { Principal, RequestContext } from '../../common/principal.js';
import type { AvScanner } from '../files/clamav.js';
import type { ObjectStore } from '../files/object-store.js';
import { renderMarkdown } from '../kb/markdown.js';

type ReleaseRow = {
  id: string;
  family_key: string;
  family_name: string;
  kind: ReleaseView['kind'];
  title: string;
  version: string;
  visibility: ReleaseView['visibility'];
  status: ReleaseView['status'];
  recommended: boolean;
  released_on: Date | string | null;
  eula_id: string | null;
  notes_html?: string;
};

const ymd = (d: Date | string | null) =>
  d === null
    ? null
    : d instanceof Date
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : String(d).slice(0, 10);

/** Session context for public routes: anonymous visitors get no tenant context at all. */
const run = <T>(db: Database, p: Principal | undefined, fn: (tx: Tx) => Promise<T>) =>
  p ? db.withTenant(p, fn) : db.withAnonymous(fn);

/**
 * Download centre. Visibility: public → anyone; registered → any signed-in account; entitled →
 * active coverage on a compatible device (staff always); internal → staff. RLS hides drafts and
 * internal releases from non-staff sessions as a second wall.
 */
@Injectable()
export class DownloadsService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Database,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(AV_SCANNER) private readonly av: AvScanner,
  ) {}

  private async access(
    tx: Tx,
    p: Principal | undefined,
    r: Pick<ReleaseRow, 'id' | 'visibility'>,
  ): Promise<ReleaseView['access']> {
    if (r.visibility === 'public') return 'download';
    if (!p) return 'sign_in';
    if (p.isInternal || r.visibility === 'registered') return 'download';
    const ok = await sql<{
      ok: boolean;
    }>`SELECT wd.entitled_to_release(${r.id}::uuid) AS ok`.execute(tx);
    return ok.rows[0]?.ok ? 'download' : 'entitlement_required';
  }

  private async view(tx: Tx, p: Principal | undefined, rows: ReleaseRow[]): Promise<ReleaseView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [files, products, eulas, accepted] = await Promise.all([
      tx
        .selectFrom('release_file')
        .select(['id', 'release_id', 'file_name', 'size_bytes', 'sha256', 'scan_status'])
        .where('release_id', 'in', ids)
        .where('scan_status', '!=', 'infected')
        .orderBy('file_name')
        .execute(),
      tx
        .selectFrom('release_product as rp')
        .innerJoin('product as p', 'p.id', 'rp.product_id')
        .select(['rp.release_id', 'p.sku', 'p.model_name'])
        .where('rp.release_id', 'in', ids)
        .orderBy('p.sku')
        .execute(),
      tx
        .selectFrom('eula')
        .select(['id', 'title', 'version'])
        .where('id', 'in', [
          ...new Set(rows.map((r) => r.eula_id).filter((x): x is string => !!x)),
          randomUUID(),
        ])
        .execute(),
      p
        ? tx
            .selectFrom('eula_acceptance')
            .select('eula_id')
            .where('user_id', '=', p.userId)
            .execute()
        : Promise.resolve([] as { eula_id: string }[]),
    ]);
    const acc = new Set(accepted.map((a) => a.eula_id));
    const out: ReleaseView[] = [];
    for (const r of rows) {
      const e = eulas.find((x) => x.id === r.eula_id);
      out.push({
        id: r.id,
        family: { key: r.family_key, name: r.family_name },
        kind: r.kind,
        title: r.title,
        version: r.version,
        visibility: r.visibility,
        status: r.status,
        recommended: r.recommended,
        releasedOn: ymd(r.released_on),
        access: await this.access(tx, p, r),
        products: products
          .filter((x) => x.release_id === r.id)
          .map((x) => ({ sku: x.sku, modelName: x.model_name })),
        files: files
          .filter((f) => f.release_id === r.id && (p?.isInternal || f.scan_status === 'clean'))
          .map((f) => ({
            id: f.id,
            fileName: f.file_name,
            sizeBytes: Number(f.size_bytes),
            sha256: f.sha256,
            ready: f.scan_status === 'clean',
          })),
        eula: e ? { id: e.id, title: e.title, version: e.version, accepted: acc.has(e.id) } : null,
        ...(r.notes_html !== undefined ? { notesHtml: r.notes_html } : {}),
      });
    }
    return out;
  }

  private base(tx: Tx) {
    return tx
      .selectFrom('software_release as r')
      .innerJoin('product_family as f', 'f.id', 'r.family_id')
      .select([
        'r.id',
        'f.key as family_key',
        'f.name as family_name',
        'r.kind',
        'r.title',
        'r.version',
        'r.visibility',
        'r.status',
        'r.recommended',
        'r.released_on',
        'r.eula_id',
      ]);
  }

  async list(
    p: Principal | undefined,
    q: { family?: string; kind?: ReleaseView['kind']; q?: string },
  ): Promise<{ items: ReleaseView[] }> {
    return run(this.db, p, async (tx) => {
      let s = this.base(tx)
        .where('r.status', 'in', ['published', 'deprecated'])
        .orderBy('f.sort_order')
        .orderBy('r.recommended', 'desc')
        .orderBy('r.released_on', 'desc')
        .limit(200);
      if (!p?.isInternal) s = s.where('r.visibility', '!=', 'internal');
      if (q.family) s = s.where('f.key', '=', q.family);
      if (q.kind) s = s.where('r.kind', '=', q.kind);
      if (q.q) {
        const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        s = s.where((eb) =>
          eb.or([
            eb('r.title', 'ilike', like),
            eb('r.version', 'ilike', like),
            eb.exists(
              eb
                .selectFrom('release_product as rp')
                .innerJoin('product as pr', 'pr.id', 'rp.product_id')
                .select(sql`1`.as('x'))
                .whereRef('rp.release_id', '=', 'r.id')
                .where((e2) =>
                  e2.or([e2('pr.sku', 'ilike', like), e2('pr.model_name', 'ilike', like)]),
                ),
            ),
          ]),
        );
      }
      return { items: await this.view(tx, p, (await s.execute()) as ReleaseRow[]) };
    });
  }

  async get(p: Principal | undefined, id: string): Promise<ReleaseView> {
    return run(this.db, p, async (tx) => {
      let s = this.base(tx).select(['r.notes_html', 'r.notes_md']).where('r.id', '=', id);
      if (!p?.isInternal)
        s = s
          .where('r.status', 'in', ['published', 'deprecated'])
          .where('r.visibility', '!=', 'internal');
      const r = (await s.executeTakeFirst()) as (ReleaseRow & { notes_md: string }) | undefined;
      if (!r) throw notFound('Release');
      const v = (await this.view(tx, p, [r]))[0]!;
      return p?.isInternal ? { ...v, notesMd: r.notes_md } : v;
    });
  }

  async eula(id: string) {
    const e = await this.db.withAnonymous((tx) =>
      tx
        .selectFrom('eula')
        .select(['id', 'title', 'version', 'body_html'])
        .where('id', '=', id)
        .executeTakeFirst(),
    );
    if (!e) throw notFound('Licence agreement');
    return { id: e.id, title: e.title, version: e.version, bodyHtml: e.body_html };
  }

  async acceptEula(p: Principal, ctx: RequestContext, eulaId: string) {
    await this.db.withTenant(p, async (tx) => {
      const e = await tx
        .selectFrom('eula')
        .select('id')
        .where('id', '=', eulaId)
        .executeTakeFirst();
      if (!e) throw notFound('Licence agreement');
      await tx
        .insertInto('eula_acceptance')
        .values({ user_id: p.userId, eula_id: e.id })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'eula.accept', orgId: p.orgId, targetType: 'eula', targetId: e.id },
      );
    });
  }

  /** Checks access and licence, records the download, and returns a short-lived URL. */
  async link(p: Principal | undefined, ctx: RequestContext, fileId: string): Promise<DownloadLink> {
    return run(this.db, p, async (tx) => {
      const f = await tx
        .selectFrom('release_file as rf')
        .innerJoin('software_release as r', 'r.id', 'rf.release_id')
        .select([
          'rf.id',
          'rf.file_name',
          'rf.sha256',
          'rf.object_key',
          'rf.scan_status',
          'r.id as release_id',
          'r.visibility',
          'r.status',
          'r.eula_id',
          'r.title',
          'r.version',
        ])
        .where('rf.id', '=', fileId)
        .executeTakeFirst();
      if (
        !f ||
        (!p?.isInternal &&
          (f.visibility === 'internal' || !['published', 'deprecated'].includes(f.status)))
      )
        throw notFound('File');
      const a = await this.access(tx, p, { id: f.release_id, visibility: f.visibility });
      if (a === 'sign_in')
        throw new ProblemError(401, 'sign-in-required', 'Sign in to download this file');
      if (a === 'entitlement_required')
        throw new ProblemError(
          403,
          'entitlement-required',
          'An active support contract is needed for this download',
          'Your organisation has no active coverage on a model this release supports. Request a renewal quote from the Devices page.',
        );
      if (f.eula_id && p && !p.isInternal) {
        const ok = await tx
          .selectFrom('eula_acceptance')
          .select('eula_id')
          .where('user_id', '=', p.userId)
          .where('eula_id', '=', f.eula_id)
          .executeTakeFirst();
        if (!ok) throw new ProblemError(409, 'eula-required', 'Accept the licence agreement first');
      }
      if (f.scan_status !== 'clean' || !f.object_key)
        throw new ProblemError(
          409,
          'not-ready',
          'This file is still being checked. Try again in a few minutes.',
        );
      await tx
        .insertInto('download_event')
        .values({
          file_id: f.id,
          user_id: p?.userId ?? null,
          org_id: p?.orgId ?? null,
          ip: ctx.ip ?? null,
        })
        .execute();
      if (p)
        await audit(
          tx,
          { ...ctx, actorId: p.userId },
          {
            action: 'download',
            orgId: p.orgId,
            targetType: 'release_file',
            targetId: f.id,
            diff: { release: `${f.title} ${f.version}`, file: f.file_name },
          },
        );
      const ttl = this.cfg.DOWNLOAD_URL_TTL_SECONDS;
      return {
        url: await this.store.signedDownloadUrl('attachments', f.object_key, f.file_name, ttl),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        fileName: f.file_name,
        sha256: f.sha256,
      };
    });
  }

  // ------------------------------------------------------------------ staff authoring

  async eulas() {
    return this.db.withAnonymous(async (tx) => ({
      items: await tx
        .selectFrom('eula')
        .select(['id', 'title', 'version'])
        .orderBy('created_at', 'desc')
        .execute(),
    }));
  }

  async adminList(p: Principal): Promise<{ items: ReleaseView[] }> {
    return this.db.withTenant(p, async (tx) => {
      const rows = await this.base(tx).orderBy('r.created_at', 'desc').limit(300).execute();
      return { items: await this.view(tx, p, rows as ReleaseRow[]) };
    });
  }

  private async resolveRefs(tx: Tx, b: ReleaseDraftRequest) {
    const fam = await tx
      .selectFrom('product_family')
      .select('id')
      .where('key', '=', b.familyKey)
      .executeTakeFirst();
    if (!fam) throw unprocessable('familyKey', 'Unknown product family');
    const prods = b.productSkus.length
      ? await tx
          .selectFrom('product')
          .select(['id', 'sku', 'family_id'])
          .where('sku', 'in', b.productSkus)
          .execute()
      : [];
    const missing = b.productSkus.filter((s) => !prods.some((p) => p.sku === s));
    if (missing.length) throw unprocessable('productSkus', `Unknown models: ${missing.join(', ')}`);
    if (prods.some((p) => p.family_id !== fam.id))
      throw unprocessable('productSkus', 'Every model must belong to the chosen family');
    let eulaId: string | null = null;
    if (b.eulaVersion) {
      const e = await tx
        .selectFrom('eula')
        .select('id')
        .where('version', '=', b.eulaVersion)
        .executeTakeFirst();
      if (!e) throw unprocessable('eulaVersion', 'Unknown licence agreement');
      eulaId = e.id;
    }
    return { familyId: fam.id, productIds: prods.map((p) => p.id), eulaId };
  }

  async create(p: Principal, ctx: RequestContext, b: ReleaseDraftRequest): Promise<ReleaseView> {
    const id = await this.db.withTenant(p, async (tx) => {
      const ref = await this.resolveRefs(tx, b);
      const dup = await tx
        .selectFrom('software_release')
        .select('id')
        .where('family_id', '=', ref.familyId)
        .where('kind', '=', b.kind)
        .where('version', '=', b.version)
        .executeTakeFirst();
      if (dup) throw conflict('release-exists', 'This version already exists for the family');
      const r = await tx
        .insertInto('software_release')
        .values({
          family_id: ref.familyId,
          kind: b.kind,
          title: b.title,
          version: b.version,
          visibility: b.visibility,
          recommended: b.recommended,
          released_on: b.releasedOn ?? null,
          notes_md: b.notesMd,
          notes_html: renderMarkdown(b.notesMd),
          eula_id: ref.eulaId,
          created_by: p.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (ref.productIds.length)
        await tx
          .insertInto('release_product')
          .values(ref.productIds.map((product_id) => ({ release_id: r.id, product_id })))
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'release.create', orgId: null, targetType: 'release', targetId: r.id },
      );
      return r.id;
    });
    return this.get(p, id);
  }

  async update(
    p: Principal,
    ctx: RequestContext,
    id: string,
    b: ReleaseDraftRequest,
  ): Promise<ReleaseView> {
    await this.db.withTenant(p, async (tx) => {
      const ref = await this.resolveRefs(tx, b);
      const r = await tx
        .updateTable('software_release')
        .set({
          family_id: ref.familyId,
          kind: b.kind,
          title: b.title,
          version: b.version,
          visibility: b.visibility,
          recommended: b.recommended,
          released_on: b.releasedOn ?? null,
          notes_md: b.notesMd,
          notes_html: renderMarkdown(b.notesMd),
          eula_id: ref.eulaId,
        })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!r) throw notFound('Release');
      await tx.deleteFrom('release_product').where('release_id', '=', id).execute();
      if (ref.productIds.length)
        await tx
          .insertInto('release_product')
          .values(ref.productIds.map((product_id) => ({ release_id: id, product_id })))
          .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        { action: 'release.update', orgId: null, targetType: 'release', targetId: id },
      );
    });
    return this.get(p, id);
  }

  async setStatus(p: Principal, ctx: RequestContext, id: string, status: ReleaseView['status']) {
    await this.db.withTenant(p, async (tx) => {
      const r = await tx
        .selectFrom('software_release')
        .select(['id', 'status'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r) throw notFound('Release');
      if (status === 'published') {
        const ready = await tx
          .selectFrom('release_file')
          .select('id')
          .where('release_id', '=', id)
          .where('scan_status', '=', 'clean')
          .executeTakeFirst();
        if (!ready) throw conflict('no-files', 'Add at least one checked file before publishing');
      }
      await tx
        .updateTable('software_release')
        .set({
          status,
          ...(status === 'published' && r.status === 'draft' ? { published_at: new Date() } : {}),
        })
        .where('id', '=', id)
        .execute();
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: `release.${status}`,
          orgId: null,
          targetType: 'release',
          targetId: id,
          diff: { from: r.status, to: status },
        },
      );
    });
    return this.get(p, id);
  }

  /**
   * Streams an uploaded file into quarantine while computing its SHA-256, then queues the virus
   * scan. Firmware images can be large, so the body is never buffered in memory.
   */
  async addFile(
    p: Principal,
    ctx: RequestContext,
    releaseId: string,
    fileName: string,
    body: Readable,
    maxBytes: number,
  ): Promise<{ id: string; sha256: string; sizeBytes: number }> {
    const rel = await this.db.withTenant(p, (tx) =>
      tx.selectFrom('software_release').select('id').where('id', '=', releaseId).executeTakeFirst(),
    );
    if (!rel) throw notFound('Release');
    const exists = await this.db.withTenant(p, (tx) =>
      tx
        .selectFrom('release_file')
        .select('id')
        .where('release_id', '=', releaseId)
        .where('file_name', '=', fileName)
        .executeTakeFirst(),
    );
    if (exists) throw conflict('file-exists', 'A file with this name is already attached');

    const qKey = `releases/${releaseId}/${randomUUID()}`;
    const hash = createHash('sha256');
    let size = 0;
    let tooBig = false;
    const pass = new PassThrough();
    body.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        tooBig = true;
        body.unpipe(pass);
        pass.destroy(new Error('too large'));
        body.resume();
        return;
      }
      hash.update(c);
    });
    body.pipe(pass);
    try {
      await this.store.put('quarantine', qKey, pass);
    } catch (e) {
      await this.store.delete('quarantine', qKey).catch(() => undefined);
      if (tooBig) throw new ProblemError(413, 'file-too-large', 'The file is too large');
      throw e;
    }
    if (size === 0) {
      await this.store.delete('quarantine', qKey).catch(() => undefined);
      throw unprocessable('file', 'The file is empty');
    }
    const sha256 = hash.digest('hex');
    const id = await this.db.withTenant(p, async (tx) => {
      const f = await tx
        .insertInto('release_file')
        .values({
          release_id: releaseId,
          file_name: fileName,
          size_bytes: size,
          sha256,
          quarantine_key: qKey,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await emit(tx, 'release.file.scan', null, { fileId: f.id });
      await audit(
        tx,
        { ...ctx, actorId: p.userId },
        {
          action: 'release.file.add',
          orgId: null,
          targetType: 'release_file',
          targetId: f.id,
          diff: { fileName, sha256, size },
        },
      );
      return f.id;
    });
    return { id, sha256, sizeBytes: size };
  }

  /** Worker: antivirus, then move from quarantine to the downloads area. Fails closed. */
  async scanFile(fileId: string): Promise<'clean' | 'infected' | 'skipped' | 'error'> {
    const f = await this.db.withSystem((tx) =>
      tx
        .selectFrom('release_file')
        .select(['id', 'release_id', 'file_name', 'quarantine_key', 'scan_status'])
        .where('id', '=', fileId)
        .executeTakeFirst(),
    );
    if (!f || f.scan_status !== 'pending' || !f.quarantine_key) return 'skipped';
    try {
      const res = await this.av.scan(await this.store.get('quarantine', f.quarantine_key));
      if (!res.clean) {
        await this.db.withSystem((tx) =>
          tx
            .updateTable('release_file')
            .set({ scan_status: 'infected' })
            .where('id', '=', f.id)
            .execute(),
        );
        await this.store.delete('quarantine', f.quarantine_key).catch(() => undefined);
        logger.warn({ fileId, signature: res.signature }, 'release file failed antivirus scan');
        return 'infected';
      }
      const objectKey = `releases/${f.release_id}/${f.id}`;
      await this.store.put(
        'attachments',
        objectKey,
        await this.store.get('quarantine', f.quarantine_key),
      );
      await this.db.withSystem((tx) =>
        tx
          .updateTable('release_file')
          .set({ scan_status: 'clean', object_key: objectKey, quarantine_key: null })
          .where('id', '=', f.id)
          .where('scan_status', '=', 'pending')
          .execute(),
      );
      await this.store.delete('quarantine', f.quarantine_key).catch(() => undefined);
      return 'clean';
    } catch (err) {
      logger.error({ err, fileId }, 'release file scan failed; stays quarantined');
      return 'error';
    }
  }
}
