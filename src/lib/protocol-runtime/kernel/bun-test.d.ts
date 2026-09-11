/**
 * RTN-001 — Ambient type declaration for the 'bun:test' module.
 *
 * The kernel's *.test.ts suites run under Bun's built-in test runner
 * (`bun test src/lib/protocol-runtime/kernel`). Bun's own types are not a
 * package dependency of this repository, and the DEP-003 dependency guard
 * (scripts/validate_durable.py) pins package.json dependencies exactly — so
 * this ambient declaration, INSIDE the RTN-001 owned surface, declares
 * exactly the matcher subset the kernel suites use. It exists purely so
 * `tsc --noEmit` and `next build` typecheck the test files without adding a
 * dependency; at runtime the real `bun:test` implementation is used.
 *
 * Not a protocol type: no spec citation applies (test tooling only).
 */

declare module 'bun:test' {
  type TestFn = () => void | Promise<void>;

  interface ExpectMatchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toMatch(pattern: RegExp | string): void;
    toThrow(expected?: RegExp | string | Error): void;
    toBeGreaterThan(expected: number): void;
    not: ExpectMatchers;
  }

  function describe(name: string, fn: () => void): void;
  function test(name: string, fn: TestFn): void;
  function expect(received: unknown): ExpectMatchers;

  export { describe, test, expect };
  export type { TestFn, ExpectMatchers };
}
