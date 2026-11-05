'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ADVISORY_SEVERITY_LABELS,
  type AdvisoryEditorView,
  type AdvisorySeverity,
} from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

type Row = { sku: string; affectedVersions: string; fixedVersion: string };

/** PSIRT editor: draft, publish, revise (with a change note) and withdraw. */
export function AdvisoryEditor({
  products,
  advisory,
}: {
  products: { sku: string; modelName: string }[];
  advisory?: AdvisoryEditorView;
}) {
  const router = useRouter();
  const a = advisory;
  const [f, setF] = useState({
    title: a?.title ?? '',
    summary: a?.summary ?? '',
    severity: (a?.severity ?? 'medium') as AdvisorySeverity,
    cvssScore: a?.cvssScore?.toString() ?? '',
    cvssVector: a?.cvssVector ?? '',
    cveIds: a?.cveIds.join(', ') ?? '',
    bodyMd: a?.bodyMd ?? '',
    workaroundMd: a?.workaroundMd ?? '',
    internalNotes: a?.internalNotes ?? '',
    revisionNote: '',
  });
  const [rows, setRows] = useState<Row[]>(
    a?.affected.map((x) => ({
      sku: x.sku,
      affectedVersions: x.affectedVersions,
      fixedVersion: x.fixedVersion ?? '',
    })) ?? [{ sku: products[0]?.sku ?? '', affectedVersions: '', fixedVersion: '' }],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const published = a?.status === 'published';
  const withdrawn = a?.status === 'withdrawn';
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const body = () => ({
    title: f.title,
    summary: f.summary,
    severity: f.severity,
    cvssScore: f.cvssScore ? Number(f.cvssScore) : null,
    cvssVector: f.cvssVector.trim() || null,
    cveIds: f.cveIds
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    bodyMd: f.bodyMd,
    workaroundMd: f.workaroundMd,
    internalNotes: f.internalNotes,
    affected: rows
      .filter((r) => r.sku && r.affectedVersions.trim())
      .map((r) => ({
        sku: r.sku,
        affectedVersions: r.affectedVersions.trim(),
        fixedVersion: r.fixedVersion.trim() || null,
      })),
    ...(f.revisionNote.trim() ? { revisionNote: f.revisionNote.trim() } : {}),
  });

  const call = async (what: string, fn: () => Promise<AdvisoryEditorView>, done: string) => {
    setBusy(what);
    setErr(null);
    setOk(null);
    try {
      const r = await fn();
      if (!a) router.push(`/admin/advisories/${r.wdId}`);
      else {
        setOk(done);
        setF({ ...f, revisionNote: '' });
        router.refresh();
      }
    } catch (e) {
      setErr(
        e instanceof ClientApiError
          ? (e.errors?.map((x) => `${x.path}: ${x.message}`).join('; ') ?? e.detail ?? e.title)
          : 'That did not work',
      );
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    call(
      'save',
      () =>
        apiFetch<AdvisoryEditorView>(
          a ? `/v1/admin/advisories/${a.wdId}` : '/v1/admin/advisories',
          {
            method: a ? 'PUT' : 'POST',
            body: body(),
          },
        ),
      published ? 'New revision published.' : 'Draft saved.',
    );

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <form
        className="min-w-0 max-w-3xl space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {err && <Notice tone="error">{err}</Notice>}
        {ok && <Notice tone="success">{ok}</Notice>}
        <fieldset disabled={withdrawn} className="space-y-5">
          <Field label="Title" required>
            {(p) => <Input {...p} maxLength={200} value={f.title} onChange={set('title')} />}
          </Field>
          <Field label="Summary" required hint="One or two sentences customers read first.">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                maxLength={1000}
                value={f.summary}
                onChange={set('summary')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Severity" required>
              {(p) => (
                <Select {...p} value={f.severity} onChange={set('severity')}>
                  {Object.entries(ADVISORY_SEVERITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="CVSS score">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={f.cvssScore}
                  onChange={set('cvssScore')}
                />
              )}
            </Field>
            <Field label="CVE IDs" hint="Comma separated">
              {(p) => (
                <Input {...p} className="font-mono" value={f.cveIds} onChange={set('cveIds')} />
              )}
            </Field>
          </div>
          <Field label="CVSS vector">
            {(p) => (
              <Input
                {...p}
                className="font-mono"
                placeholder="CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
                value={f.cvssVector}
                onChange={set('cvssVector')}
              />
            )}
          </Field>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Affected models</legend>
            {rows.map((r, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1.2fr_1fr_0.8fr_auto] sm:items-end">
                <Field label="Model">
                  {(p) => (
                    <Select
                      {...p}
                      value={r.sku}
                      onChange={(e) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, sku: e.target.value } : x)))
                      }
                    >
                      {products.map((pr) => (
                        <option key={pr.sku} value={pr.sku}>
                          {pr.modelName}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Affected versions">
                  {(p) => (
                    <Input
                      {...p}
                      className="font-mono"
                      placeholder="7.1.000 to 7.1.070"
                      value={r.affectedVersions}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) =>
                            j === i ? { ...x, affectedVersions: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <Field label="Fixed in">
                  {(p) => (
                    <Input
                      {...p}
                      className="font-mono"
                      value={r.fixedVersion}
                      onChange={(e) =>
                        setRows(
                          rows.map((x, j) =>
                            j === i ? { ...x, fixedVersion: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label={`Remove affected model row ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                setRows([
                  ...rows,
                  { sku: products[0]?.sku ?? '', affectedVersions: '', fixedVersion: '' },
                ])
              }
            >
              Add a model
            </Button>
          </fieldset>

          <Field label="Workaround" hint="Markdown. What customers can do before upgrading.">
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                className="font-mono text-sm"
                value={f.workaroundMd}
                onChange={set('workaroundMd')}
              />
            )}
          </Field>
          <Field label="Details" hint="Markdown.">
            {(p) => (
              <Textarea
                {...p}
                rows={8}
                className="font-mono text-sm"
                value={f.bodyMd}
                onChange={set('bodyMd')}
              />
            )}
          </Field>
          <Field
            label="PSIRT notes (staff only)"
            hint="Reporter, upstream references, timelines. Never shown to customers."
          >
            {(p) => (
              <Textarea {...p} rows={4} value={f.internalNotes} onChange={set('internalNotes')} />
            )}
          </Field>
          {published && (
            <Field
              label="What changed"
              required
              hint="Published with the new revision and in the update email."
            >
              {(p) => (
                <Input
                  {...p}
                  maxLength={500}
                  value={f.revisionNote}
                  onChange={set('revisionNote')}
                />
              )}
            </Field>
          )}
          <Button type="submit" busy={busy === 'save'}>
            {!a ? 'Create draft' : published ? 'Publish revision' : 'Save draft'}
          </Button>
        </fieldset>
      </form>

      {a && (
        <aside className="space-y-6 text-sm">
          <section aria-labelledby="st-h">
            <h2 id="st-h" className="font-semibold">
              Status
            </h2>
            <p className="mt-1">
              {a.status === 'draft' && 'Draft: visible only to staff.'}
              {published && `Published, revision ${a.revision}.`}
              {withdrawn && 'Withdrawn.'}
            </p>
            {a.status !== 'draft' && (
              <Link
                href={`/advisories/${a.wdId}`}
                className="mt-1 inline-block text-teal-ink underline underline-offset-2"
              >
                View public page
              </Link>
            )}
          </section>
          {a.status === 'draft' && (
            <Button
              busy={busy === 'publish'}
              onClick={() =>
                call(
                  'publish',
                  () =>
                    apiFetch<AdvisoryEditorView>(`/v1/admin/advisories/${a.wdId}/publish`, {
                      method: 'POST',
                    }),
                  'Published. Notifications are on their way.',
                )
              }
            >
              Publish advisory
            </Button>
          )}
          {published && (
            <section aria-labelledby="wd-h" className="space-y-2">
              <h2 id="wd-h" className="font-semibold">
                Withdraw
              </h2>
              <Field label="Reason shown to readers">
                {(p) => (
                  <Input
                    {...p}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
              <Button
                size="sm"
                variant="danger"
                disabled={reason.trim().length < 5}
                busy={busy === 'withdraw'}
                onClick={() =>
                  call(
                    'withdraw',
                    () =>
                      apiFetch<AdvisoryEditorView>(`/v1/admin/advisories/${a.wdId}/withdraw`, {
                        method: 'POST',
                        body: { reason: reason.trim() },
                      }),
                    'Withdrawn.',
                  )
                }
              >
                Withdraw advisory
              </Button>
            </section>
          )}
        </aside>
      )}
    </div>
  );
}
