'use client';
import { useState } from 'react';
import type { AnnouncementAdmin, AnnouncementAudience, AnnouncementTone } from '@wd/contracts';
import { Button, EmptyState, Field, Input, Notice, Select, Textarea, fmtIst } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const TONES: Record<AnnouncementTone, string> = {
  info: 'Notice',
  maintenance: 'Planned maintenance',
  incident: 'Service incident (cannot be dismissed)',
};
const AUDIENCES: Record<AnnouncementAudience, string> = {
  everyone: 'Everyone, including visitors',
  customers: 'Signed-in customers and partners',
  staff: 'WatchDog staff only',
};
const STATE = { scheduled: 'Scheduled', live: 'Showing now', ended: 'Ended' } as const;

interface Form {
  id: string | null;
  title: string;
  body: string;
  linkUrl: string;
  tone: AnnouncementTone;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string;
}
const blank: Form = {
  id: null,
  title: '',
  body: '',
  linkUrl: '',
  tone: 'info',
  audience: 'everyone',
  startsAt: '',
  endsAt: '',
};
/** <input type="datetime-local"> works in the browser's own time zone. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

export function AnnouncementsManager({ initial }: { initial: AnnouncementAdmin[] }) {
  const [items, setItems] = useState(initial);
  const [f, setF] = useState<Form>(blank);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const upsert = (a: AnnouncementAdmin) =>
    setItems((xs) => [a, ...xs.filter((x) => x.id !== a.id)]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const body = {
        title: f.title,
        body: f.body,
        linkUrl: f.linkUrl.trim() || null,
        tone: f.tone,
        audience: f.audience,
        startsAt: toIso(f.startsAt),
        endsAt: toIso(f.endsAt),
      };
      const a = await apiFetch<AnnouncementAdmin>(
        f.id ? `/v1/admin/announcements/${f.id}` : '/v1/admin/announcements',
        { method: f.id ? 'PUT' : 'POST', body },
      );
      upsert(a);
      setMsg({
        tone: 'success',
        text:
          a.state === 'live'
            ? 'Saved. The banner is showing now.'
            : 'Saved. The banner is scheduled.',
      });
      setF(blank);
    } catch (err) {
      setMsg({
        tone: 'error',
        text: err instanceof ClientApiError ? (err.detail ?? err.title) : 'Could not save',
      });
    } finally {
      setBusy(null);
    }
  }

  async function end(a: AnnouncementAdmin) {
    setBusy(a.id);
    try {
      upsert(
        await apiFetch<AnnouncementAdmin>(`/v1/admin/announcements/${a.id}/end`, {
          method: 'POST',
        }),
      );
      setMsg({ tone: 'success', text: `Taken down: ${a.title}` });
    } catch (err) {
      setMsg({
        tone: 'error',
        text: err instanceof ClientApiError ? err.title : 'Could not end it',
      });
    } finally {
      setBusy(null);
    }
  }

  const edit = (a: AnnouncementAdmin) =>
    setF({
      id: a.id,
      title: a.title,
      body: a.body,
      linkUrl: a.linkUrl ?? '',
      tone: a.tone,
      audience: a.audience,
      startsAt: toLocal(a.startsAt),
      endsAt: toLocal(a.endsAt),
    });

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section aria-labelledby="ann-list">
        <h2 id="ann-list" className="sr-only">
          All announcements
        </h2>
        {items.length === 0 ? (
          <EmptyState title="No announcements yet">
            Write one when a maintenance window is planned or something affects customers.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted">
                    {STATE[a.state]}. {TONES[a.tone].replace(/ \(.*\)$/, '')} for{' '}
                    {AUDIENCES[a.audience].toLowerCase()}. From {fmtIst(a.startsAt)}
                    {a.endsAt ? ` to ${fmtIst(a.endsAt)}` : ' until taken down'}. By {a.createdBy}.
                  </p>
                </div>
                {a.state !== 'ended' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => edit(a)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={busy === a.id}
                      onClick={() => end(a)}
                      aria-label={`Take down: ${a.title}`}
                    >
                      Take down
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        onSubmit={save}
        className="flex flex-col gap-4 self-start rounded-m border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">{f.id ? 'Edit announcement' : 'New announcement'}</h2>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Field label="Headline" required>
          {(p) => (
            <Input
              {...p}
              value={f.title}
              maxLength={120}
              onChange={(e) => set('title', e.target.value)}
            />
          )}
        </Field>
        <Field label="More detail" hint="One or two sentences. Up to 500 characters.">
          {(p) => (
            <Textarea
              {...p}
              value={f.body}
              rows={3}
              maxLength={500}
              onChange={(e) => set('body', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Details link"
          hint="A portal page such as /advisories, or an https:// address."
        >
          {(p) => (
            <Input {...p} value={f.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} />
          )}
        </Field>
        <Field label="Kind">
          {(p) => (
            <Select
              {...p}
              value={f.tone}
              onChange={(e) => set('tone', e.target.value as AnnouncementTone)}
            >
              {Object.entries(TONES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Who sees it">
          {(p) => (
            <Select
              {...p}
              value={f.audience}
              onChange={(e) => set('audience', e.target.value as AnnouncementAudience)}
            >
              {Object.entries(AUDIENCES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Show from" hint="Leave empty to show it now.">
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={f.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          )}
        </Field>
        <Field label="Show until" hint="Leave empty to keep it up until you take it down.">
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              value={f.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
            />
          )}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" busy={busy === 'save'} disabled={f.title.trim().length < 3}>
            {f.id ? 'Save changes' : 'Publish announcement'}
          </Button>
          {f.id && (
            <Button type="button" variant="secondary" onClick={() => setF(blank)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
