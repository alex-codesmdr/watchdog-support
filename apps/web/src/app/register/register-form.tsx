'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { RegistrationRequest } from '@wd/contracts';
import { Button, Field, Input, Notice } from '@wd/ui';
import type { z } from 'zod';
import { apiFetch, ClientApiError } from '@/lib/client';

const NOTICE_VERSION = '2026-11-01';
type Form = z.input<typeof RegistrationRequest>;

export function RegisterForm() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(RegistrationRequest),
    defaultValues: { consentNoticeVersion: NOTICE_VERSION },
  });
  const e = formState.errors;

  if (done)
    return (
      <Notice tone="success" title="Registration received">
        {done}
      </Notice>
    );

  return (
    <form
      noValidate
      className="flex flex-col gap-5 rounded-m border border-line bg-surface p-6"
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        try {
          const r = await apiFetch<{ message: string }>('/v1/public/registrations', {
            method: 'POST',
            body: v,
          });
          setDone(r.message);
        } catch (err) {
          setError(err instanceof ClientApiError ? err.title : 'Registration failed. Try again.');
        }
      })}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Organisation name" required error={e.organizationName?.message}>
        {(p) => <Input {...p} {...register('organizationName')} autoComplete="organization" />}
      </Field>
      <Field
        label="GSTIN"
        hint="15 characters, for invoices and RMA paperwork. Optional."
        error={e.gstin?.message}
      >
        {(p) => (
          <Input {...p} {...register('gstin')} className="font-mono uppercase" maxLength={15} />
        )}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Your name" required error={e.adminName?.message}>
          {(p) => <Input {...p} {...register('adminName')} autoComplete="name" />}
        </Field>
        <Field label="Phone" hint="For P1 call-backs. Optional." error={e.phone?.message}>
          {(p) => <Input {...p} {...register('phone')} type="tel" autoComplete="tel" />}
        </Field>
      </div>
      <Field label="Work email" required error={e.adminEmail?.message}>
        {(p) => <Input {...p} {...register('adminEmail')} type="email" autoComplete="email" />}
      </Field>
      <input type="hidden" {...register('consentNoticeVersion')} />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-[rgb(var(--wd-teal))]"
          {...register('consentGiven')}
          aria-invalid={e.consentGiven ? true : undefined}
        />
        <span>
          I agree that WatchDog may process the details above to provide support services, as
          described in the{' '}
          <a
            href="/privacy"
            className="text-teal-ink underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            privacy notice
          </a>
          . I can withdraw consent at any time.
          {e.consentGiven && (
            <span className="mt-1 block font-medium text-danger">
              Consent is needed to create an account.
            </span>
          )}
        </span>
      </label>
      <Button type="submit" busy={formState.isSubmitting} className="self-start">
        Submit registration
      </Button>
    </form>
  );
}
