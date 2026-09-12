/**
 * UI-010 evidence tooling — the path resolver hook (see alias-loader.mjs).
 *
 * Maps two things plain Node ESM cannot resolve in this repository:
 *   1. the product layer's `@/` alias (tsconfig paths `@/*` → `src/*`);
 *   2. EXTENSIONLESS relative imports (`./adapter-boundary`), which the
 *      bundler-resolved product modules use — mapped to `.ts` siblings.
 *
 * Everything else resolves through Node's default resolution. TypeScript
 * type stripping is native in Node ≥ 23.6 (Node 24.19 here).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function hasExtension(specifier) {
  // Treat a trailing ".ts"/".js"/".mjs"/".json"/".css" etc. (any short
  // suffix after the last dot within the last path segment) as an
  // extension. Query/fragment free specifiers only.
  const lastSegment = specifier.split('/').pop() ?? '';
  return /^\.[a-z0-9]+$/i.test(lastSegment.slice(lastSegment.lastIndexOf('.'))) && lastSegment.includes('.');
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = join(REPO_ROOT, 'src', specifier.slice(2));
    const mapped = pathToFileURL(
      hasExtension(specifier) ? target : `${target}.ts`,
    ).href;
    return nextResolve(mapped, context);
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL !== undefined &&
    !hasExtension(specifier)
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const candidate = join(parentDir, specifier);
    const asTs = `${candidate}.ts`;
    try {
      return await nextResolve(pathToFileURL(asTs).href, context);
    } catch {
      // Fall through: also try .tsx, then the raw specifier.
      try {
        return await nextResolve(pathToFileURL(`${candidate}.tsx`).href, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
