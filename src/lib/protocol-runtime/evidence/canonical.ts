/**
 * RTN-002 — Evidence Authority: canonical JSON encoding.
 *
 * The deterministic encoder underlying BOTH derived evidence write keys
 * (INV-15-4) and the hash-chain record hashes (INV-15-3). Every value that
 * enters an evidence derivation or a record hash passes through this one
 * encoder, so identical inputs always yield identical encodings (and
 * therefore identical keys and hashes).
 *
 * Spec sources (binding):
 *   spec/architecture/v0.1/README.md §3 GC-1, lines 39-43:
 *     "GC-1 — Exact, deterministic financial arithmetic. ... Re-running any
 *      computation on identical inputs yields identical outputs."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   54-55 (INV-15-3):
 *     "the hash chain verifies deterministically from genesis; verification
 *      is a pure function of the log."
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, lines
 *   56-58 (INV-15-4):
 *     "evidence write keys derived from the subject operation id prevent
 *      duplicate records for one operation."
 *
 * Determinism rules (each is a GC-1 discipline applied to the encoding):
 *   - Object properties are emitted in ascending code-point key order, so
 *     property insertion order never affects the encoding.
 *   - Numbers must be safe integers: floating-point values are rejected
 *     (GC-1 "no floating point anywhere"), as are NaN/Infinity and values
 *     outside the safe-integer range.
 *   - String escaping is JSON's own (deterministic for a given string).
 *   - `undefined`-valued properties are treated as absent (JSON semantics);
 *     functions, symbols, bigints, and cyclic structures are rejected with a
 *     TypeError — a submission containing them is not recordable, and a
 *     failed write fails the operation (A15 lines 62-64).
 */

/**
 * Deterministic canonical JSON encoding of a JSON-representable value.
 *
 * Object keys are sorted (code-point order); numbers must be safe integers;
 * arrays preserve element order; `undefined` properties encode as absent.
 * Non-representable values (functions, symbols, bigints, cycles, floats)
 * throw a TypeError.
 *
 * Source: GC-1 (README.md §3 lines 39-43); INV-15-3 (evidence-risk-
 * compliance.md lines 54-55); INV-15-4 (lines 56-58).
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  encodeInto(value, out, new Set());
  return out.join('');
}

function encodeInto(value: unknown, out: string[], ancestors: Set<unknown>): void {
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      encodeNumber(value, out);
      return;
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'object':
      break;
    default:
      fail(`canonicalJson: value of type ${typeof value} is not JSON-representable (GC-1 discipline)`);
  }
  if (ancestors.has(value)) {
    fail('canonicalJson: cyclic structure is not JSON-representable');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      out.push('[');
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) {
          out.push(',');
        }
        encodeInto(value[index], out, ancestors);
      }
      out.push(']');
      return;
    }
    const keys = Object.keys(value).sort();
    out.push('{');
    let first = true;
    for (const key of keys) {
      const property = (value as Record<string, unknown>)[key];
      if (property === undefined) {
        // An undefined-valued property is absent (JSON semantics).
        continue;
      }
      if (!first) {
        out.push(',');
      }
      first = false;
      out.push(JSON.stringify(key), ':');
      encodeInto(property, out, ancestors);
    }
    out.push('}');
  } finally {
    ancestors.delete(value);
  }
}

function encodeNumber(value: number, out: string[]): void {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    fail(
      `canonicalJson: number must be a safe integer — floats are forbidden by GC-1 (got ${value})`,
    );
  }
  out.push(value.toString(10));
}

function fail(message: string): never {
  throw new TypeError(message);
}
