/**
 * RTN-009 — Ambient type declaration extensions for the 'bun:test' module.
 *
 * The netting domain's *.test.ts suites run under Bun's built-in test
 * runner (`bun test src/lib/protocol-runtime/netting`). The kernel
 * (RTN-001, merged, frozen to this work order) declares the matcher
 * subset ITS suites use in its own bun-test.d.ts; this declaration, inside
 * the RTN-009 owned surface, merges with it and declares exactly the
 * additional matchers the netting and settlement suites use. It exists
 * purely so `tsc --noEmit` typechecks the test files without adding a
 * dependency; at runtime the real `bun:test` implementation is used.
 *
 * Not a protocol type: no spec citation applies (test tooling only).
 */

declare module 'bun:test' {
  interface ExpectMatchers {
    toBeDefined(): void;
    toBeUndefined(): void;
  }
}
