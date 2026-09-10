import Link from 'next/link';

/**
 * Grammar-aware not-found surface (UI-001; P1).
 *
 * A route that is not part of the navigation grammar has no surface. The
 * default framework 404 renders inside the shell (root layout: banner,
 * header, footer), so the environment signal and the least-visibility
 * navigation remain visible even here.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Route not found</h1>
      <p className="mt-3 max-w-2xl text-sm text-stone-600">
        This route is not part of the navigation grammar. Reserved routes for planned
        surfaces stay inert until their owning work items ship them, so no undocumented
        entry point exists (P1). The environment signal and the shell navigation above are
        unaffected.
      </p>
      <p className="mt-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-stone-700"
        >
          Return to the shell home
        </Link>
      </p>
    </div>
  );
}
