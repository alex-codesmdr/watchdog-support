'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KB_TYPE_LABELS, type KbEditorArticle, type KbType } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, Textarea } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const FAMILIES: Array<[string, string]> = [
  ['', 'None (all products)'],
  ['sd-wan', 'SD-WAN'],
  ['switching', 'Switching'],
  ['routing', 'Routing'],
  ['security', 'Security'],
  ['wireless', 'Wireless'],
  ['servers-storage', 'Servers & Storage'],
  ['management', 'Management'],
];
const VIS: Array<[string, string]> = [
  ['public', 'Public: anyone'],
  ['registered', 'Registered customers'],
  ['partner', 'Partners'],
  ['internal', 'Internal: staff only'],
];
const STATE_LABEL: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

export function ArticleEditor({
  initial,
  canPublish,
}: {
  initial?: KbEditorArticle;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [a, setA] = useState(initial);
  const [f, setF] = useState({
    title: initial?.title ?? '',
    summary: initial?.summary ?? '',
    bodyMd: initial?.bodyMd ?? '## Symptoms\n\n\n## Cause\n\n\n## Resolution\n\n',
    type: (initial?.type ?? 'howto') as KbType,
    visibility: initial?.visibility ?? 'public',
    familyKey: initial?.familyKey ?? '',
    productSkus: (initial?.productSkus ?? []).join(', '),
    firmwareVersions: (initial?.firmwareVersions ?? []).join(', '),
    changeNote: '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function run(label: string, fn: () => Promise<KbEditorArticle>, done: string) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      setA(r);
      setMsg({ tone: 'success', text: done });
      if (!initial) router.replace(`/workspace/kb/${r.id}`);
      else router.refresh();
    } catch (e) {
      setMsg({
        tone: 'error',
        text:
          e instanceof ClientApiError
            ? [e.title, e.detail, ...(e.errors ?? []).map((x) => `${x.path}: ${x.message}`)]
                .filter(Boolean)
                .join('. ')
            : 'That did not work.',
      });
    } finally {
      setBusy(null);
    }
  }
  const body = () => ({
    ...f,
    familyKey: f.familyKey || null,
    productSkus: list(f.productSkus),
    firmwareVersions: list(f.firmwareVersions),
    changeNote: f.changeNote || undefined,
  });
  const save = () =>
    run(
      'save',
      () =>
        a
          ? apiFetch(`/v1/kb/editor/articles/${a.id}`, { method: 'PUT', body: body() })
          : apiFetch('/v1/kb/editor/articles', { method: 'POST', body: body() }),
      a ? 'Saved as a new version.' : 'Draft created.',
    );

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_1fr]">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{a ? 'Edit article' : 'New article'}</h1>
          {a && (
            <p className="text-sm text-muted">
              {STATE_LABEL[a.state]}, version {a.currentVersion}
              {a.publishedVersion ? `, live version ${a.publishedVersion}` : ''}
            </p>
          )}
        </div>
        {a?.sourceCaseNumber && (
          <Notice tone="warning" className="mt-4" title={`Drafted from case ${a.sourceCaseNumber}`}>
            Remove customer names, IP addresses, hostnames and serial numbers before publishing.
          </Notice>
        )}
        {msg && (
          <Notice tone={msg.tone} className="mt-4">
            {msg.text}
          </Notice>
        )}
        <form
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Title" required>
            {(p) => <Input {...p} value={f.title} onChange={set('title')} maxLength={200} />}
          </Field>
          <Field
            label="Summary"
            hint="One or two sentences shown in search results. Required to publish."
          >
            {(p) => (
              <Textarea
                {...p}
                value={f.summary}
                onChange={set('summary')}
                rows={2}
                maxLength={500}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Type">
              {(p) => (
                <Select {...p} value={f.type} onChange={set('type')}>
                  {Object.entries(KB_TYPE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Visible to">
              {(p) => (
                <Select {...p} value={f.visibility} onChange={set('visibility')}>
                  {VIS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Product family">
              {(p) => (
                <Select {...p} value={f.familyKey} onChange={set('familyKey')}>
                  {FAMILIES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Product SKUs" hint="Comma-separated, e.g. WD-SW5600-48P">
              {(p) => (
                <Input
                  {...p}
                  value={f.productSkus}
                  onChange={set('productSkus')}
                  className="font-mono"
                />
              )}
            </Field>
            <Field label="Software versions" hint="Comma-separated, e.g. WOS 7.1.070">
              {(p) => (
                <Input
                  {...p}
                  value={f.firmwareVersions}
                  onChange={set('firmwareVersions')}
                  className="font-mono"
                />
              )}
            </Field>
          </div>
          <Field
            label="Article"
            hint="Markdown: ## headings, lists, tables, and ``` for CLI output. Images and HTML are not allowed."
          >
            {(p) => (
              <Textarea
                {...p}
                value={f.bodyMd}
                onChange={set('bodyMd')}
                rows={18}
                className="font-mono text-sm"
              />
            )}
          </Field>
          {a && (
            <Field label="What changed?" hint="Saved with the version history.">
              {(p) => (
                <Input {...p} value={f.changeNote} onChange={set('changeNote')} maxLength={500} />
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy === 'save'}>
              {a ? 'Save new version' : 'Create draft'}
            </Button>
            {a && a.state === 'draft' && (
              <Button
                type="button"
                variant="secondary"
                busy={busy === 'submit'}
                onClick={() =>
                  run(
                    'submit',
                    () =>
                      apiFetch(`/v1/kb/editor/articles/${a.id}/submit`, {
                        method: 'POST',
                        body: {},
                      }),
                    'Sent for review.',
                  )
                }
              >
                Send for review
              </Button>
            )}
            {a &&
              canPublish &&
              a.state !== 'archived' &&
              (a.state !== 'published' || a.currentVersion !== a.publishedVersion) && (
                <Button
                  type="button"
                  variant="secondary"
                  busy={busy === 'publish'}
                  onClick={() =>
                    run(
                      'publish',
                      () =>
                        apiFetch(`/v1/kb/editor/articles/${a.id}/publish`, {
                          method: 'POST',
                          body: {},
                        }),
                      'Published. Readers now see this version.',
                    )
                  }
                >
                  Publish version {a.currentVersion}
                </Button>
              )}
            {a && canPublish && a.state !== 'archived' && (
              <Button
                type="button"
                variant="ghost"
                busy={busy === 'archive'}
                onClick={() =>
                  run(
                    'archive',
                    () =>
                      apiFetch(`/v1/kb/editor/articles/${a.id}/archive`, {
                        method: 'POST',
                        body: {},
                      }),
                    'Archived. Readers can no longer see it.',
                  )
                }
              >
                Archive
              </Button>
            )}
            {a?.publishedVersion && a.state !== 'archived' && (
              <a
                href={`/kb/${a.slug}`}
                className="self-center text-sm text-teal-ink underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                View live article
              </a>
            )}
          </div>
        </form>
      </div>
      <section aria-labelledby="pv" className="rounded-m border border-line bg-surface p-6">
        <h2 id="pv" className="text-sm font-semibold text-muted">
          Preview of saved version
        </h2>
        {a ? (
          <div
            className="wd-prose wd-article mt-4"
            dangerouslySetInnerHTML={{ __html: a.previewHtml }}
          />
        ) : (
          <p className="mt-4 text-sm text-muted">Create the draft to see the preview.</p>
        )}
      </section>
    </div>
  );
}
