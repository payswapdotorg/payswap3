/**
 * PC-001 — Ambient type augmentation for the 'bun:test' module.
 *
 * The repository's ambient declaration
 * (src/lib/protocol-runtime/kernel/bun-test.d.ts, RTN-001 owned — NOT
 * modifiable from this work item) declares exactly the matcher subset the
 * kernel suites use, because Bun's own types are not a package dependency
 * and the dependency guard pins package.json exactly. The console suites
 * additionally use `mock.module(...)` (to drive the request-context chain
 * through the REAL audience authority under test). This file, inside the
 * PC-001 owned surface, adds that export to the ambient module
 * declaration — no new dependency, no modification of the RTN-001 owned
 * file. At runtime the real `bun:test` implementation is used (behavior
 * verified by probe before adoption). The console suites deliberately use
 * only the ORIGINAL matcher subset otherwise.
 */

declare module 'bun:test' {
  interface MockModuleApi {
    module(specifier: string, factory: () => unknown): unknown;
  }

  const mock: MockModuleApi;

  export { mock };
}
