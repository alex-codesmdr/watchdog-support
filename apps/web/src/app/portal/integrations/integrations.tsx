'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  API_KEY_SCOPE_LABELS,
  API_KEY_SCOPES,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  type ApiKeyView,
  type WebhookEvent,
  type WebhookView,
} from '@wd/contracts';
import { Button, Dialog, Field, Input, Notice, cn } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const fmt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : 'Never';
const errText = (e: unknown, fallback: string) =>
  e instanceof ClientApiError
    ? (e.errors?.map((x) => x.message).join('; ') ?? e.detail ?? e.title)
    : fallback;

/** Shows a secret exactly once, with copy, and makes clear it cannot be shown again. */
function OneTimeSecret({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <Notice tone="warning" title={`Copy the ${label} now`}>
        It is shown only once. Store it in your system&apos;s secret store.
      </Notice>
      <code className="block rounded-s border border-line bg-surface p-3 font-mono text-sm break-all select-all">
        {value}
      </code>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard blocked: the value is selectable */
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" onClick={onDone}>
          I have stored it
        </Button>
      </div>
    </div>
  );
}

export function Integrations({ keys, hooks }: { keys: ApiKeyView[]; hooks: WebhookView[] }) {
  const router = useRouter();
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-semibold">API keys and webhooks</h1>
        <p className="mt-1 max-w-prose text-muted">
          Connect your ticketing or monitoring system to WatchDog Support. API keys let your system
          read and open cases; webhooks tell it the moment something changes. Base address:{' '}
          <code className="font-mono">/api/v1</code> on this site. Reference:{' '}
          <a href="/api/openapi.json" className="text-teal-ink underline underline-offset-2">
            OpenAPI description
          </a>{' '}
          (import it into Postman or your API tool).
        </p>
      </div>
      <Keys keys={keys} onChange={() => router.refresh()} />
      <Hooks hooks={hooks} onChange={() => router.refresh()} />
    </div>
  );
}

function Keys({ keys, onChange }: { keys: ApiKeyView[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['cases:read']);
  const [days, setDays] = useState('365');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setBusy('create');
    setErr(null);
    try {
      const r = await apiFetch<{ key: string }>('/v1/org/api-keys', {
        method: 'POST',
        body: { name, scopes, expiresInDays: Number(days) },
      });
      setCreated(r.key);
    } catch (e) {
      setErr(errText(e, 'The key could not be created'));
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (k: ApiKeyView) => {
    setBusy(k.id);
    try {
      await apiFetch(`/v1/org/api-keys/${k.id}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      setErr(errText(e, 'The key could not be revoked'));
    } finally {
      setBusy(null);
    }
  };
  const close = () => {
    setOpen(false);
    setCreated(null);
    setName('');
    setScopes(['cases:read']);
    onChange();
  };
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <section aria-labelledby="keys-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="keys-h" className="text-lg font-semibold">
            API keys
          </h2>
          <p className="text-sm text-muted">
            Send the key in the header <code className="font-mono">Authorization: WD-Key …</code>. A
            key acts as you, limited to the access you choose, and stops working if your account is
            disabled.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Create API key
        </Button>
      </div>
      {err && !open && <Notice tone="error">{err}</Notice>}
      {keys.length === 0 ? (
        <p className="text-sm text-muted">No keys yet.</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="API keys">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Key</th>
                <th className="py-2 pr-4 font-medium">Access</th>
                <th className="py-2 pr-4 font-medium">Last used</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...active, ...keys.filter((k) => k.revokedAt)].map((k) => (
                <tr key={k.id} className={cn(k.revokedAt && 'text-muted')}>
                  <td className="py-2 pr-4">{k.name}</td>
                  <td className="py-2 pr-4 font-mono">{k.prefix}_…</td>
                  <td className="py-2 pr-4">
                    {k.scopes.map((s) => API_KEY_SCOPE_LABELS[s]).join(', ')}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{fmt(k.lastUsedAt)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {k.revokedAt ? `Revoked ${fmt(k.revokedAt)}` : fmt(k.expiresAt)}
                  </td>
                  <td className="py-2 text-right">
                    {!k.revokedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        busy={busy === k.id}
                        onClick={() => revoke(k)}
                        aria-label={`Revoke API key ${k.name}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={created ? 'Your new API key' : 'Create an API key'}
      >
        {created ? (
          <OneTimeSecret label="API key" value={created} onDone={close} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            {err && <Notice tone="error">{err}</Notice>}
            <Field label="Name" required hint="Which system uses it, e.g. ServiceNow sync.">
              {(p) => (
                <Input
                  {...p}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Access</legend>
              {API_KEY_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                    }
                  />
                  {API_KEY_SCOPE_LABELS[s]}
                </label>
              ))}
            </fieldset>
            <Field label="Expires after (days)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={730}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy === 'create'}
                disabled={!name.trim() || !scopes.length}
              >
                Create key
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}

function Hooks({ hooks, onChange }: { hooks: WebhookView[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['case.created', 'case.status_changed']);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const create = async () => {
    setBusy('create');
    setErr(null);
    try {
      const r = await apiFetch<{ secret: string }>('/v1/org/webhooks', {
        method: 'POST',
        body: { url, events },
      });
      setCreated(r.secret);
    } catch (e) {
      setErr(errText(e, 'The webhook could not be added'));
    } finally {
      setBusy(null);
    }
  };
  const act = async (
    h: WebhookView,
    what: 'test' | 'enable' | 'disable' | 'delete' | 'rotate-secret',
  ) => {
    setBusy(`${h.id}:${what}`);
    setErr(null);
    try {
      if (what === 'delete') await apiFetch(`/v1/org/webhooks/${h.id}`, { method: 'DELETE' });
      else if (what === 'test') {
        const r = await apiFetch<{ ok: boolean; status: number | null; error: string | null }>(
          `/v1/org/webhooks/${h.id}/test`,
          { method: 'POST' },
        );
        setResult({
          ...result,
          [h.id]: r.ok ? `Test delivered (HTTP ${r.status}).` : `Test failed: ${r.error}`,
        });
      } else if (what === 'rotate-secret') {
        const r = await apiFetch<{ secret: string }>(`/v1/org/webhooks/${h.id}/rotate-secret`, {
          method: 'POST',
        });
        setCreated(r.secret);
        setOpen(true);
      } else await apiFetch(`/v1/org/webhooks/${h.id}/${what}`, { method: 'POST' });
      if (what !== 'test') onChange();
    } catch (e) {
      setErr(errText(e, 'That did not work'));
    } finally {
      setBusy(null);
    }
  };
  const close = () => {
    setOpen(false);
    setCreated(null);
    setUrl('');
    onChange();
  };

  return (
    <section aria-labelledby="hooks-h" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="hooks-h" className="text-lg font-semibold">
            Webhooks
          </h2>
          <p className="max-w-prose text-sm text-muted">
            We POST a JSON event to your HTTPS address and sign it in the{' '}
            <code className="font-mono">X-WD-Signature</code> header (
            <code className="font-mono">t=…,v1=HMAC-SHA256(secret, &quot;t.body&quot;)</code>).
            Check the signature and reject events older than five minutes. Failed deliveries are
            retried for about a day.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Add webhook
        </Button>
      </div>
      {err && !open && <Notice tone="error">{err}</Notice>}
      {hooks.length === 0 ? (
        <p className="text-sm text-muted">No webhooks yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {hooks.map((h) => (
            <li key={h.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm break-all">{h.url}</p>
                  <p className="text-sm text-muted">
                    {h.events.map((e) => WEBHOOK_EVENT_LABELS[e]).join('; ')}
                  </p>
                  {!h.active && (
                    <p className="text-sm font-medium text-amber-ink">
                      Off{h.disabledReason ? `: ${h.disabledReason}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={busy === `${h.id}:test`}
                    onClick={() => act(h, 'test')}
                  >
                    Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(h, h.active ? 'disable' : 'enable')}
                  >
                    {h.active ? 'Turn off' : 'Turn on'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act(h, 'rotate-secret')}>
                    New secret
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => act(h, 'delete')}
                    aria-label={`Delete webhook ${h.url}`}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {result[h.id] && (
                <p className="text-sm" role="status">
                  {result[h.id]}
                </p>
              )}
              {h.recent.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-teal-ink">
                    Recent deliveries ({h.recent.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {h.recent.map((d) => (
                      <li key={d.id} className="flex flex-wrap gap-x-3">
                        <span className="font-mono">{d.eventType}</span>
                        <span
                          className={
                            d.status === 'succeeded'
                              ? 'text-ok'
                              : d.status === 'failed'
                                ? 'text-danger'
                                : 'text-amber-ink'
                          }
                        >
                          {d.status === 'succeeded'
                            ? 'Delivered'
                            : d.status === 'failed'
                              ? 'Failed'
                              : 'Retrying'}
                        </span>
                        <span className="text-muted">
                          {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                          {d.lastError ? `, ${d.lastError}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onClose={close} title={created ? 'Signing secret' : 'Add a webhook'}>
        {created ? (
          <OneTimeSecret label="signing secret" value={created} onDone={close} />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            {err && <Notice tone="error">{err}</Notice>}
            <Field label="Address (HTTPS)" required>
              {(p) => (
                <Input
                  {...p}
                  type="url"
                  placeholder="https://itsm.example.in/hooks/watchdog"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
            </Field>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Send these events</legend>
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={events.includes(ev)}
                    onChange={(e) =>
                      setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                    }
                  />
                  {WEBHOOK_EVENT_LABELS[ev]}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                busy={busy === 'create'}
                disabled={!url.trim() || !events.length}
              >
                Add webhook
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
