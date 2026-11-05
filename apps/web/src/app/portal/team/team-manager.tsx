'use client';
import { useState } from 'react';
import type { TeamMember, TeamRole } from '@wd/contracts';
import { Button, Field, Input, Notice, Select, fmtIst } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

const ROLE: Record<TeamRole, string> = { customer_admin: 'Administrator', customer_user: 'User' };
const STATUS = {
  invited: 'Invited, not signed in yet',
  active: 'Active',
  disabled: 'Access switched off',
};

export function TeamManager({ initial }: { initial: TeamMember[] }) {
  const [items, setItems] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('customer_user');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const fail = (err: unknown, fallback: string) =>
    setMsg({
      tone: 'error',
      text: err instanceof ClientApiError ? (err.detail ?? err.title) : fallback,
    });
  const put = (m: TeamMember) =>
    setItems((xs) =>
      [m, ...xs.filter((x) => x.id !== m.id)].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      ),
    );

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy('invite');
    setMsg(null);
    try {
      const m = await apiFetch<TeamMember>('/v1/org/users', {
        method: 'POST',
        body: { displayName: name, email, role },
      });
      put(m);
      setMsg({
        tone: 'success',
        text: `Invited ${m.displayName}. They will get an email to set up their account.`,
      });
      setName('');
      setEmail('');
      setRole('customer_user');
    } catch (err) {
      fail(err, 'Could not send the invitation');
    } finally {
      setBusy(null);
    }
  }

  async function change(
    m: TeamMember,
    body: { role?: TeamRole; status?: 'active' | 'disabled' },
    done: string,
  ) {
    setBusy(m.id);
    setMsg(null);
    try {
      put(await apiFetch<TeamMember>(`/v1/org/users/${m.id}`, { method: 'PATCH', body }));
      setMsg({ tone: 'success', text: done });
    } catch (err) {
      fail(err, 'Could not save the change');
    } finally {
      setBusy(null);
    }
  }

  async function resend(m: TeamMember) {
    setBusy(m.id);
    try {
      await apiFetch(`/v1/org/users/${m.id}/resend-invite`, { method: 'POST' });
      setMsg({ tone: 'success', text: `Sent the invitation to ${m.email} again.` });
    } catch (err) {
      fail(err, 'Could not resend');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <section aria-labelledby="people" className="min-w-0">
        <h2 id="people" className="sr-only">
          People
        </h2>
        {msg && (
          <div className="mb-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        )}
        <ul className="divide-y divide-line border-y border-line">
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.displayName}
                  {m.isMe && <span className="font-normal text-muted"> (you)</span>}
                </p>
                <p className="break-all text-sm text-muted">{m.email}</p>
                <p className="text-sm text-muted">
                  {ROLE[m.role]}. {STATUS[m.status]}
                  {m.lastLoginAt ? `. Last signed in ${fmtIst(m.lastLoginAt)}` : ''}.
                </p>
              </div>
              {!m.isMe && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={busy === m.id}
                    onClick={() =>
                      change(
                        m,
                        { role: m.role === 'customer_admin' ? 'customer_user' : 'customer_admin' },
                        m.role === 'customer_admin'
                          ? `${m.displayName} is now a user.`
                          : `${m.displayName} is now an administrator.`,
                      )
                    }
                    aria-label={
                      m.role === 'customer_admin'
                        ? `Make ${m.displayName} a user`
                        : `Make ${m.displayName} an administrator`
                    }
                  >
                    {m.role === 'customer_admin' ? 'Make user' : 'Make administrator'}
                  </Button>
                  {m.status === 'invited' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => resend(m)}
                      aria-label={`Resend invitation to ${m.displayName}`}
                    >
                      Resend invitation
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    busy={busy === m.id}
                    onClick={() =>
                      change(
                        m,
                        { status: m.status === 'disabled' ? 'active' : 'disabled' },
                        m.status === 'disabled'
                          ? `${m.displayName} can use the portal again.`
                          : `${m.displayName} can no longer sign in.`,
                      )
                    }
                    aria-label={
                      m.status === 'disabled'
                        ? `Switch on access for ${m.displayName}`
                        : `Switch off access for ${m.displayName}`
                    }
                  >
                    {m.status === 'disabled' ? 'Switch on access' : 'Switch off access'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form
        onSubmit={invite}
        className="flex flex-col gap-4 self-start rounded-m border border-line bg-surface p-4"
      >
        <h2 className="font-semibold">Invite a colleague</h2>
        <Field label="Name" required>
          {(p) => (
            <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Work email" required>
          {(p) => (
            <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Role">
          {(p) => (
            <Select {...p} value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <option value="customer_user">User: opens and follows cases</option>
              <option value="customer_admin">
                Administrator: also manages the team and settings
              </option>
            </Select>
          )}
        </Field>
        <div>
          <Button
            type="submit"
            busy={busy === 'invite'}
            disabled={name.trim().length < 2 || !email.includes('@')}
          >
            Send invitation
          </Button>
        </div>
      </form>
    </div>
  );
}
