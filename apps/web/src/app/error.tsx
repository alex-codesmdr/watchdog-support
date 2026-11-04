'use client';
import { Button } from '@wd/ui';

export default function ErrorPage({
  reset,
  error,
}: {
  reset: () => void;
  error: Error & { digest?: string };
}) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <h1 className="text-2xl font-semibold">This page did not load</h1>
      <p className="mt-3 text-muted">
        The support service did not respond. Your data is safe. Try again, and if it keeps
        happening, call the P1 line.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-muted">Reference: {error.digest}</p>
      )}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
