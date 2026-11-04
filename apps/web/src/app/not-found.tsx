import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <h1 className="text-2xl font-semibold">We could not find that page</h1>
      <p className="mt-3 text-muted">
        If you followed a link to a case, it may belong to another account, or the number may be
        mistyped.
      </p>
      <p className="mt-6">
        <Link href="/" className="font-semibold text-teal-ink underline underline-offset-2">
          Go to WatchDog Support home
        </Link>
      </p>
    </main>
  );
}
