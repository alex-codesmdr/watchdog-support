'use client';
import { useState } from 'react';
import { EMAIL_LOCALES, type Me } from '@wd/contracts';
import { Button, Field, Input, Notice, Select } from '@wd/ui';
import { useRouter } from 'next/navigation';
import { apiFetch, ClientApiError } from '@/lib/client';

export function AccountForm({ me }: { me: Me }) {
  const router = useRouter();
  const [name, setName] = useState(me.displayName);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [locale, setLocale] = useState(me.locale === 'hi-IN' ? 'hi-IN' : 'en-IN');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/v1/me', { method: 'PUT', body: { displayName: name, phone, locale } });
      setMsg({ tone: 'success', text: 'Saved.' });
      router.refresh();
    } catch (err) {
      setMsg({
        tone: 'error',
        text: err instanceof ClientApiError ? (err.detail ?? err.title) : 'Could not save',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Field label="Your name" required hint="Shown on your case messages.">
        {(p) => (
          <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field
        label="Mobile number"
        hint="Used for urgent case alerts by SMS, where your contract includes them."
      >
        {(p) => (
          <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        )}
      </Field>
      <Field label="Email language" hint="The language of the emails WatchDog Support sends you.">
        {(p) => (
          <Select
            {...p}
            value={locale}
            onChange={(e) => setLocale(e.target.value as 'en-IN' | 'hi-IN')}
          >
            {Object.entries(EMAIL_LOCALES).map(([k, v]) => (
              <option key={k} value={k} lang={k.slice(0, 2)}>
                {v}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div>
        <Button type="submit" busy={busy} disabled={name.trim().length < 2}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
