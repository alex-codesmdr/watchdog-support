'use client';
import { solveChallenge } from 'altcha-lib';
import { useState } from 'react';
import { Button, Field, Input, Notice } from '@wd/ui';
import { apiFetch, ClientApiError } from '@/lib/client';

interface Challenge {
  algorithm: string;
  challenge: string;
  salt: string;
  signature: string;
  maxnumber?: number;
}
interface Result {
  found: boolean;
  modelName: string | null;
  coverage: Array<{ kind: string; tier: string; endsOn: string; active: boolean }>;
}

const KIND: Record<string, string> = {
  warranty: 'Hardware warranty',
  amc: 'Annual maintenance contract',
  subscription: 'Software subscription',
};
const TIER: Record<string, string> = {
  standard: 'Standard',
  premium: 'Premium',
  mission_critical: 'Mission-Critical 24×7',
};
const date = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${d}T00:00:00+05:30`),
  );

/** Solves a proof-of-work challenge in the browser (no third-party CAPTCHA, no cookies). */
async function captchaToken(): Promise<string> {
  const c = await apiFetch<Challenge>('/v1/public/challenge');
  const s = await solveChallenge(c.challenge, c.salt, c.algorithm, c.maxnumber).promise;
  if (!s) throw new Error('verification');
  return btoa(
    JSON.stringify({
      algorithm: c.algorithm,
      challenge: c.challenge,
      number: s.number,
      salt: c.salt,
      signature: c.signature,
    }),
  );
}

export function WarrantyCheck() {
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(Result & { serial: string }) | null>(null);

  return (
    <div className="mt-8">
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const s = serial.trim().toUpperCase();
          if (s.length < 6)
            return setError('Enter the full serial number (at least 6 characters).');
          setBusy(true);
          setError(null);
          setResult(null);
          try {
            const captcha = await captchaToken();
            const r = await apiFetch<Result>('/v1/public/warranty-lookup', {
              method: 'POST',
              body: { serialNumber: s, captchaToken: captcha },
            });
            setResult({ ...r, serial: s });
          } catch (err) {
            setError(
              err instanceof ClientApiError
                ? err.status === 429
                  ? 'Too many lookups from your network. Try again in an hour.'
                  : err.title
                : 'The lookup did not complete. Try again.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Serial number" className="flex-1" error={error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
            />
          )}
        </Field>
        <Button type="submit" busy={busy}>
          {busy ? 'Checking' : 'Check coverage'}
        </Button>
      </form>

      <div aria-live="polite" className="mt-6">
        {result && !result.found && (
          <Notice tone="warning" title={`We could not find ${result.serial}`}>
            Check the serial on the device label. Devices bought through a partner may not be
            registered yet: ask your partner or open a case.
          </Notice>
        )}
        {result?.found && (
          <section className="rounded-m border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">{result.modelName}</h2>
            <p className="font-mono text-sm text-muted">{result.serial}</p>
            {result.coverage.length ? (
              <ul className="mt-4 divide-y divide-line">
                {result.coverage.map((c) => (
                  <li
                    key={`${c.kind}${c.endsOn}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                  >
                    <span>
                      <span className="font-medium">{KIND[c.kind] ?? c.kind}</span>
                      <span className="block text-sm text-muted">
                        {TIER[c.tier] ?? c.tier} support
                      </span>
                    </span>
                    <span className={c.active ? 'text-ok' : 'font-semibold text-danger'}>
                      {c.active ? `Active until ${date(c.endsOn)}` : `Expired on ${date(c.endsOn)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-danger">
                No warranty or support contract is recorded for this device.
              </p>
            )}
            {result.coverage.some((c) => c.active) ? (
              <p className="mt-4 text-sm">
                <a
                  className="font-semibold text-teal-ink underline underline-offset-2"
                  href={`/portal/cases/new?serial=${encodeURIComponent(result.serial)}`}
                >
                  Open a case for this device
                </a>
              </p>
            ) : (
              <p className="mt-4 text-sm text-muted">
                To renew coverage, contact your WatchDog account manager or partner.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
