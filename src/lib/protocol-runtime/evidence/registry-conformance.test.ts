/**
 * RTN-002 — registry conformance test.
 *
 * Source of the tested contract:
 *   spec/registry/protocol-registry.json — every area's "owningAuthority"
 *   value is the authority-name vocabulary the Evidence Authority accepts
 *   (the RTN-002 acceptance: "authority names are the registry's owning
 *   authorities"). A schema contradiction between A15 and the registry is a
 *   work-order stop condition: this test makes such a contradiction LOUD
 *   (a failing test) instead of silent.
 *   spec/architecture/v0.1/evidence-risk-compliance.md §1 Area 15, line 29:
 *     "authority: which protocol authority performed the operation."
 *   spec/architecture/v0.1/README.md §3 GC-5, lines 63-67 (five fields).
 *
 * This suite reads the registry JSON (and the A15 section) from the
 * repository tree at TEST TIME ONLY — the runtime module encodes the frozen
 * list as a constant and never imports from spec/ (a deployed image need
 * not ship the spec tree).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_AUTHORITIES, EVIDENCE_AUTHORITY_NAME } from './record.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(HERE, '..', '..', '..', '..');

interface RegistryArea {
  id: string;
  owningAuthority: string;
}

describe('registry conformance (the authority vocabulary is the registry\'s)', () => {
  test('EVIDENCE_AUTHORITIES equals the registry owning-authority set, exactly', () => {
    const registry = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, 'spec', 'registry', 'protocol-registry.json'), 'utf8'),
    ) as { areas: RegistryArea[] };
    const registryNames = [...new Set(registry.areas.map((area) => area.owningAuthority))].sort();
    expect(registry.areas.length).toBe(24);
    expect([...EVIDENCE_AUTHORITIES].sort()).toEqual(registryNames);
    // The "Rail Authority" owns two areas (A13 external rails and A23
    // blockchain rails) — 24 areas over 23 distinct names.
    expect(registryNames.length).toBe(23);
  });

  test('the Evidence Authority is the A15 owner in the registry', () => {
    const registry = JSON.parse(
      readFileSync(join(REPOSITORY_ROOT, 'spec', 'registry', 'protocol-registry.json'), 'utf8'),
    ) as { areas: RegistryArea[] };
    const area15 = registry.areas.find((area) => area.id === 'A15');
    expect(area15?.owningAuthority).toBe(EVIDENCE_AUTHORITY_NAME);
  });
});

describe('A15 section conformance (the spec text is the contract)', () => {
  test('the A15 section defines exactly the five slots this module materializes', () => {
    const section = readFileSync(
      join(REPOSITORY_ROOT, 'spec', 'architecture', 'v0.1', 'evidence-risk-compliance.md'),
      'utf8',
    ).replace(/\s+/g, ' '); // normalize line wrapping — phrases, not layout, are the contract
    // The five mandatory semantic slots, verbatim from the frozen section
    // (field-by-field conformance of the materialized record is asserted in
    // record.test.ts; this asserts the spec text itself says what we
    // implemented — the guard against drift in EITHER direction).
    expect(section).toContain('Fields (mandatory, exactly these five semantic slots)');
    expect(section).toContain('what: operation type and subject object ids.');
    expect(section).toContain('when: protocol time (sequenced) and recorded wall time.');
    expect(section).toContain('authority: which protocol authority performed the operation.');
    expect(section).toContain('outcome: resulting state or decision, including reason codes.');
    expect(section).toContain('proof: hashes, sequence numbers, and links to prior records');
    expect(section).toContain('State: WRITTEN (terminal). Records are never updated or deleted.');
    expect(section).toContain('Each record\'s proof includes the hash of its predecessor, making tampering detectable');
    expect(section).toContain('an operation is not committed until its record is written');
    expect(section).toContain('A failed write fails the operation');
    expect(section).toContain('writers-by-submission only; none can alter or suppress records');
    expect(section).toContain('(log genesis, verification runs)');
  });

  test('GC-5 in the v0.1 README names exactly the five fields', () => {
    const readme = readFileSync(
      join(REPOSITORY_ROOT, 'spec', 'architecture', 'v0.1', 'README.md'),
      'utf8',
    );
    expect(readme).toContain('exactly one evidence record (area 15) with fields: what, when, authority,');
    expect(readme).toContain('outcome, proof.');
  });
});
