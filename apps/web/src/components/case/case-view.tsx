'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RMA_STATUS_LABELS, type RmaStatus } from '@wd/contracts';
import { RmaPanel } from '@/components/rma/rma-panel';
import { useRef, useState } from 'react';
import {
  OPEN_STATUSES,
  STATUS_LABELS,
  type AttachmentView,
  type CaseDetail,
  type CaseStatus,
  type SavedReply,
} from '@wd/contracts';
import {
  Button,
  cn,
  Dialog,
  Field,
  Notice,
  SeverityBadge,
  SlaBar,
  StatusPill,
  Textarea,
} from '@wd/ui';
import { CsatScale } from '@/app/csat/csat-form';
import { apiFetch, ClientApiError } from '@/lib/client';
import { METRIC } from './case-list';
import { Uploader, type UploadItem } from './uploader';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
const fmtSize = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : n >= 1024
        ? `${Math.round(n / 1024)} KB`
        : `${n} bytes`;
const TIER: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  mission_critical: 'Mission-Critical 24×7',
};
const EVENT: Record<string, (d: Record<string, unknown>) => string> = {
  created: () => 'Case opened',
  status_changed: (d) => `Status changed to ${STATUS_LABELS[d.to as CaseStatus] ?? d.to}`,
  escalated: (d) => `Escalated to ${Number(d.toLevel) >= 4 ? 'Engineering' : `L${d.toLevel}`}`,
  customer_escalated: () => 'Escalated to WatchDog management',
  assigned: (d) => (d.auto ? 'Assigned automatically' : 'Assigned'),
  routed: (d) => `Routed by the rule "${String(d.rule ?? '')}"`,
  csat_submitted: (d) => `Rated ${d.score} of 5`,
  sla_warning: (d) =>
    `SLA warning: ${METRIC[String(d.metric)] ?? d.metric} at ${d.threshold}% of target`,
  sla_breached: (d) =>
    `SLA breached: ${METRIC[String(d.metric)] ?? d.metric}${d.escalatedTo ? `, auto-escalated to L${d.escalatedTo}` : ''}`,
  rma_status: (d) =>
    d.from
      ? `${d.rma}: ${RMA_STATUS_LABELS[d.to as RmaStatus] ?? d.to}`
      : `Replacement requested (${d.rma})`,
  email_attachments_skipped: (d) =>
    `${d.count} email attachment(s) not imported (too large, or more than 10 files). Upload them in the portal.`,
};
const TRANSITION_LABEL: Partial<Record<CaseStatus, string>> = {
  triage: 'Move to triage',
  in_progress: 'Start work',
  awaiting_customer: 'Wait for customer',
  awaiting_vendor: 'Send to engineering',
  workaround_provided: 'Workaround provided',
  resolved: 'Mark resolved',
  closed: 'Close case',
  reopened: 'Reopen case',
};

export function CaseView({
  initial,
  staff,
  meId,
  meName = '',
  justCreated,
  canRma = false,
}: {
  initial: CaseDetail;
  staff: boolean;
  meId: string;
  meName?: string;
  justCreated?: boolean;
  /** The viewer may request (or manage) RMAs. */
  canRma?: boolean;
}) {
  const qc = useQueryClient();
  const key = ['case', initial.number];
  const { data: c } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<CaseDetail>(`/v1/cases/${initial.number}`),
    initialData: initial,
    refetchInterval: 30_000,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [escalateOpen, setEscalateOpen] = useState(false);

  async function act(label: string, path: string, body: unknown, headers?: Record<string, string>) {
    setBusy(label);
    setError(null);
    try {
      const r = await apiFetch<CaseDetail>(`/v1/cases/${c.number}${path}`, {
        method: 'POST',
        body,
        headers,
      });
      qc.setQueryData(key, r);
      return true;
    } catch (e) {
      setError(
        e instanceof ClientApiError
          ? [e.title, e.detail].filter(Boolean).join('. ')
          : 'That did not work. Try again.',
      );
      if (e instanceof ClientApiError && e.status === 412)
        void qc.invalidateQueries({ queryKey: key });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const open = OPEN_STATUSES.includes(c.status);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_19rem]">
      <div className="min-w-0">
        {justCreated && (
          <Notice tone="success" className="mb-6" title={`Case ${c.number} is open`}>
            We emailed you a confirmation. You can reply to that email to add information.
          </Notice>
        )}
        <header>
          <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span className="font-mono">{c.number}</span>
            <SeverityBadge severity={c.severity} />
            <StatusPill label={STATUS_LABELS[c.status]} open={open} />
            {staff && (
              <span>
                L{Math.min(c.supportLevel, 3)}
                {c.supportLevel >= 4 ? ' / Engineering' : ''}
              </span>
            )}
          </p>
          <h1 className="mt-2 text-2xl font-semibold">{c.subject}</h1>
          <p className="mt-1 text-sm text-muted">
            {staff && <>{c.orgName}. </>}Raised by {c.requesterName} on {when(c.openedAt)} IST.{' '}
            {c.assigneeName ? `Engineer: ${c.assigneeName}.` : 'Waiting for an engineer.'}
          </p>
        </header>

        {error && (
          <Notice tone="error" className="mt-4">
            {error}
          </Notice>
        )}

        <section aria-label="Conversation" className="mt-6">
          <ol className="flex flex-col gap-4">
            {c.messages.map((m) => (
              <li
                key={m.id}
                className={cn(
                  'rounded-m border p-4',
                  m.visibility === 'internal'
                    ? 'border-amber/50 bg-amber/5'
                    : m.author.isStaff
                      ? 'border-teal/30 bg-surface'
                      : 'border-line bg-surface',
                )}
              >
                <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-semibold">{m.author.name}</span>
                  {m.author.isStaff && <span className="text-teal-ink">WatchDog Support</span>}
                  {m.visibility === 'internal' && (
                    <span className="font-semibold text-amber-ink">
                      Internal note (not visible to customer)
                    </span>
                  )}
                  <span className="text-muted">
                    {when(m.createdAt)}
                    {m.source === 'email' ? ', by email' : ''}
                  </span>
                </p>
                <div className="wd-prose mt-2" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                {m.attachments.length > 0 && <Attachments items={m.attachments} />}
              </li>
            ))}
          </ol>
        </section>

        {c.can.reply || c.can.internalNote ? (
          <Composer
            c={c}
            staff={staff}
            myName={meName}
            busy={busy}
            onSend={(body) => act('reply', '/messages', body)}
          />
        ) : c.status === 'closed' ? (
          <Notice className="mt-6">
            This case is closed. Reopen it to continue the conversation.
          </Notice>
        ) : null}

        {c.events.length > 0 && (
          <details className="mt-8 text-sm">
            <summary className="cursor-pointer font-medium">History ({c.events.length})</summary>
            <ol className="mt-2 space-y-1 border-l border-line pl-4 text-muted">
              {c.events.map((e) => (
                <li key={e.id}>
                  {when(e.at)}: {(EVENT[e.type] ?? (() => e.type))(e.data)}
                  {e.actorName ? `, by ${e.actorName}` : ''}
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      <aside className="flex flex-col gap-6">
        <section aria-labelledby="sla" className="rounded-m border border-line bg-surface p-4">
          <h2 id="sla" className="font-semibold">
            Service levels
          </h2>
          <p className="text-sm text-muted">{c.tier ? TIER[c.tier] : 'No contract'}</p>
          <div className="mt-4 flex flex-col gap-4">
            {c.sla.map((s) => (
              <SlaBar
                key={s.metric}
                label={METRIC[s.metric] ?? s.metric}
                percent={s.percentElapsed}
                remainingSeconds={s.remainingSeconds}
                met={!!s.metAt}
                paused={s.paused}
                dueAt={s.dueAt}
              />
            ))}
            {!c.sla.length && <p className="text-sm text-muted">No SLA applies to this case.</p>}
          </div>
        </section>

        <section aria-labelledby="dev" className="text-sm">
          <h2 id="dev" className="font-semibold">
            Device
          </h2>
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1">
            <dt className="text-muted">Model</dt>
            <dd>{c.modelName ?? '—'}</dd>
            <dt className="text-muted">Serial</dt>
            <dd className="font-mono">{c.serialNumber ?? '—'}</dd>
            <dt className="text-muted">Version</dt>
            <dd className="font-mono">{c.softwareVersion ?? '—'}</dd>
          </dl>
        </section>

        {canRma && (
          <RmaPanel
            caseNumber={c.number}
            base={staff ? '/workspace/rmas' : '/portal/rmas'}
            canRequest={canRma && !!c.serialNumber}
            caseOpen={c.status !== 'closed'}
          />
        )}

        {(c.allowedTransitions.length > 0 ||
          c.can.escalate ||
          c.can.customerEscalate ||
          c.can.assign) && (
          <section aria-labelledby="act" className="flex flex-col gap-2">
            <h2 id="act" className="font-semibold">
              Actions
            </h2>
            {staff && c.can.assign && c.assigneeId !== meId && (
              <Button
                variant="secondary"
                busy={busy === 'assign'}
                onClick={() => act('assign', '/assign', { assigneeId: meId })}
              >
                Assign to me
              </Button>
            )}
            {c.allowedTransitions.map((to) => (
              <Button
                key={to}
                variant={to === 'resolved' ? 'primary' : 'secondary'}
                busy={busy === to}
                onClick={() => act(to, '/transition', { to }, { 'if-match': `"${c.version}"` })}
              >
                {TRANSITION_LABEL[to] ?? STATUS_LABELS[to]}
              </Button>
            ))}
            {staff && (c.status === 'resolved' || c.status === 'closed') && (
              <Button
                variant="ghost"
                busy={busy === 'kb'}
                onClick={async () => {
                  setBusy('kb');
                  try {
                    const d = await apiFetch<{ id: string }>(
                      `/v1/kb/editor/from-case/${c.number}`,
                      { method: 'POST', body: {} },
                    );
                    window.location.href = `/workspace/kb/${d.id}`;
                  } catch (e) {
                    setError(e instanceof ClientApiError ? e.title : 'Could not create the draft.');
                    setBusy(null);
                  }
                }}
              >
                Draft a knowledge article
              </Button>
            )}
            {(c.can.escalate || c.can.customerEscalate) && (
              <Button variant="ghost" onClick={() => setEscalateOpen(true)}>
                {staff
                  ? `Escalate to ${c.supportLevel >= 3 ? 'Engineering' : `L${c.supportLevel + 1}`}`
                  : 'Escalate to management'}
              </Button>
            )}
          </section>
        )}

        {c.can.submitCsat && (
          <CsatPanel
            onSubmit={(score, comment) =>
              act('csat', '/csat', { score, comment: comment || undefined })
            }
            busy={busy === 'csat'}
          />
        )}
        {c.csat && (
          <p className="text-sm text-muted">
            Rated {c.csat.score} of 5{c.csat.comment ? `: “${c.csat.comment}”` : ''}
          </p>
        )}
      </aside>

      <EscalateDialog
        open={escalateOpen}
        staff={staff}
        onClose={() => setEscalateOpen(false)}
        onSubmit={async (justification) => {
          if (await act('escalate', '/escalate', { justification })) setEscalateOpen(false);
        }}
        busy={busy === 'escalate'}
      />
    </div>
  );
}

function Attachments({ items }: { items: AttachmentView[] }) {
  const [err, setErr] = useState<string | null>(null);
  const STATE: Record<string, string> = {
    pending: 'Scanning…',
    infected: 'Blocked: malware detected',
    rejected: 'Blocked: executable files are not accepted',
    error: 'Scan failed',
  };
  return (
    <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-x-3">
          {a.scanStatus === 'clean' ? (
            <button
              className="font-mono text-teal-ink underline underline-offset-2"
              onClick={async () => {
                try {
                  const r = await apiFetch<{ url: string }>(`/v1/attachments/${a.id}/url`);
                  window.location.href = r.url.replace(/^https?:\/\/[^/]+\/api\//, '/api/');
                } catch {
                  setErr('Download link could not be created.');
                }
              }}
            >
              {a.fileName}
            </button>
          ) : (
            <span className="font-mono text-muted">{a.fileName}</span>
          )}
          <span className="text-muted">
            {a.scanStatus === 'clean' ? fmtSize(a.sizeBytes) : STATE[a.scanStatus]}
          </span>
          {a.secretsMasked && (
            <span className="text-amber-ink">
              {a.maskedCount} secret{a.maskedCount > 1 ? 's' : ''} masked
            </span>
          )}
        </li>
      ))}
      {err && <li className="text-danger">{err}</li>}
    </ul>
  );
}

/** Fills a saved reply's placeholders from the case and hands the text to the reply box. */
function SavedReplyPicker({
  c,
  myName,
  onPick,
}: {
  c: CaseDetail;
  myName: string;
  onPick: (text: string) => void;
}) {
  const q = useQuery({
    queryKey: ['saved-replies'],
    queryFn: () => apiFetch<{ items: SavedReply[] }>('/v1/saved-replies'),
    staleTime: 60_000,
  });
  const items = q.data?.items ?? [];
  const fill = (t: string) =>
    t
      .replaceAll('{{customer_name}}', c.requesterName)
      .replaceAll('{{organisation}}', c.orgName)
      .replaceAll('{{case_ref}}', c.number)
      .replaceAll('{{my_name}}', myName);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted">Insert a saved reply</span>
        <select
          value=""
          disabled={!items.length}
          onChange={(e) => {
            const r = items.find((i) => i.id === e.target.value);
            if (r) onPick(fill(r.body));
          }}
          className="h-9 max-w-xs rounded-s border border-line bg-surface px-2"
        >
          <option value="">
            {q.isLoading ? 'Loading…' : items.length ? 'Choose…' : 'None saved yet'}
          </option>
          {items.some((i) => !i.shared) && (
            <optgroup label="Yours">
              {items
                .filter((i) => !i.shared)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
            </optgroup>
          )}
          {items.some((i) => i.shared) && (
            <optgroup label="Shared">
              {items
                .filter((i) => i.shared)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </label>
      <a href="/workspace/saved-replies" className="text-teal-ink underline underline-offset-2">
        Manage saved replies
      </a>
    </div>
  );
}

function Composer({
  c,
  staff,
  myName,
  busy,
  onSend,
}: {
  c: CaseDetail;
  staff: boolean;
  myName: string;
  busy: string | null;
  onSend: (b: unknown) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [files, setFiles] = useState<UploadItem[]>([]);
  const uploading = files.some((f) => !f.id && !f.error);
  return (
    <form
      className={cn(
        'mt-6 flex flex-col gap-3 rounded-m border p-4',
        internal ? 'border-amber/60 bg-amber/5' : 'border-line bg-surface',
      )}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        const ok = await onSend({
          visibility: internal ? 'internal' : 'public',
          body,
          uploadIds: files.filter((f) => f.id).map((f) => f.id),
          setStatus: status || undefined,
        });
        if (ok) {
          setBody('');
          setFiles([]);
          setStatus('');
        }
      }}
    >
      {staff && c.can.internalNote && (
        <div role="radiogroup" aria-label="Reply type" className="flex gap-1 text-sm">
          {[
            ['Reply to customer', false],
            ['Internal note', true],
          ].map(([l, v]) => (
            <button
              key={String(l)}
              type="button"
              role="radio"
              aria-checked={internal === v}
              onClick={() => setInternal(v as boolean)}
              className={cn(
                'rounded-s px-3 py-1.5',
                internal === v ? 'bg-navy text-white' : 'text-muted hover:text-ink',
              )}
            >
              {l as string}
            </button>
          ))}
        </div>
      )}
      <Field
        label={internal ? 'Internal note' : staff ? 'Reply to customer' : 'Add a reply'}
        hint={internal ? 'Only WatchDog staff can see this.' : 'Wrap CLI output in ``` lines.'}
      >
        {(p) => (
          <Textarea
            {...p}
            ref={box}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
          />
        )}
      </Field>
      {staff && c.can.internalNote && (
        <SavedReplyPicker
          c={c}
          myName={myName}
          onPick={(text) => {
            const el = box.current;
            const at = el ? el.selectionStart : body.length;
            const end = el ? el.selectionEnd : body.length;
            const next = body.slice(0, at) + text + body.slice(end);
            setBody(next);
            requestAnimationFrame(() => {
              el?.focus();
              el?.setSelectionRange(at + text.length, at + text.length);
            });
          }}
        />
      )}
      <Uploader items={files} onChange={setFiles} />
      <div className="flex flex-wrap items-center gap-3">
        {staff && !internal && c.allowedTransitions.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">and set status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CaseStatus)}
              className="h-9 rounded-s border border-line bg-surface px-2"
            >
              <option value="">unchanged</option>
              {c.allowedTransitions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" busy={busy === 'reply'} disabled={uploading || !body.trim()}>
          {internal ? 'Add note' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}

function EscalateDialog({
  open,
  staff,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  staff: boolean;
  onClose: () => void;
  onSubmit: (j: string) => void;
  busy: boolean;
}) {
  const [j, setJ] = useState('');
  const short = j.trim().length < 20;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={staff ? 'Escalate to the next level' : 'Escalate to WatchDog management'}
    >
      <p className="text-sm text-muted">
        {staff
          ? 'The case leaves your queue and goes to the next support level. Explain what has been done and why.'
          : 'A support manager reviews every escalation. Tell us why this needs more attention, for example business impact or missed updates.'}
      </p>
      <Field label="Justification" required hint="At least 20 characters.">
        {(p) => <Textarea {...p} value={j} onChange={(e) => setJ(e.target.value)} rows={4} />}
      </Field>
      <div className="flex gap-3">
        <Button onClick={() => onSubmit(j)} disabled={short} busy={busy}>
          Escalate
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

function CsatPanel({
  onSubmit,
  busy,
}: {
  onSubmit: (score: number, comment: string) => void;
  busy: boolean;
}) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  return (
    <section aria-labelledby="csat" className="rounded-m border border-line bg-surface p-4">
      <h2 id="csat" className="font-semibold">
        How did we do?
      </h2>
      <CsatScale value={score} onChange={setScore} name="case-csat" />
      <Textarea
        className="mt-3"
        aria-label="Comment (optional)"
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
      />
      <Button
        className="mt-3"
        disabled={!score}
        busy={busy}
        onClick={() => onSubmit(score, comment)}
      >
        Send rating
      </Button>
    </section>
  );
}
