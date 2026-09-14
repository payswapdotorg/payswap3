/**
 * PC-001 — Shared console primitives barrel (files directly under
 * src/components/console/ ONLY — shell/ and views/ subdirectories belong to
 * PC-002/PC-004 and are intentionally absent here).
 *
 * Governance: this tree is mechanically scanned by
 * src/lib/console/governance.test.ts — no console component may import
 * financial persistence/authority writers.
 */

export * from './console-status';
export * from './authority-line';
