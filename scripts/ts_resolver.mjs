/**
 * SYS-001 — the plain-Node module resolver for the product layer's
 * TypeScript modules (the UI-010 evidence tooling's alias-resolver
 * pattern, promoted into scripts/ as the shared harness helper).
 *
 * Maps two things plain Node ESM cannot resolve in this repository:
 *   1. the product layer's `@/` alias (tsconfig paths `@/*` → `src/*`);
 *   2. EXTENSIONLESS relative imports (`./adapter-boundary`), which the
 *      bundler-resolved product modules use — mapped to `.ts`/`.tsx`
 *      siblings.
 *
 * Everything else resolves through Node's default resolution. TypeScript
 * type stripping is native in Node >= 23.6 (or via
 * --experimental-strip-types on earlier versions; the harnesses
 * self-configure the flags).
 *
 * Registered from a harness via:
 *   import { register } from 'node:module';
 *   register(new URL('./ts_resolver.mjs', import.meta.url));
 *
 * NOT a test harness (the scripts/test_*.mjs glob does not match it);
 * the ci-cd.md harnesses gate enumerates only test_* files.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function hasExtension(specifier) {
  const lastSegment = specifier.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0) {
    return false;
  }
  return /^\.[a-z0-9]+$/i.test(lastSegment.slice(dot));
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
    try {
      return await nextResolve(pathToFileURL(`${candidate}.ts`).href, context);
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
