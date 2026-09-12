/**
 * RTN-011 — Ambient type declaration extensions for the 'bun:test' module.
 *
 * The transition and hosting *.test.ts suites run under Bun's built-in
 * test runner (`bun test src/lib/protocol-runtime`). The kernel (RTN-001,
 * merged, frozen to this work order) declares the matcher subset ITS
 * suites use in its own bun-test.d.ts, and RTN-009's settlement
 * declaration merges two more; this declaration, inside the RTN-011
 * owned surface, merges with them and declares exactly the additional
 * matchers the transition/hosting suites use. It exists purely so
 * `tsc --noEmit` typechecks the test files without adding a dependency;
 * at runtime the real `bun:test` implementation is used.
 *
 * Not a protocol type: no spec citation applies (test tooling only).
 */

declare module 'bun:test' {
  interface ExpectMatchers {
    toBeTruthy(): void;
    toBeNull(): void;
  }
}
