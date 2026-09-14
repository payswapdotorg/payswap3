/**
 * PC-001 — Console contracts barrel: the frozen surface later console phases
 * (PC-002..PC-007) consume. Nothing here is a financial authority; these are
 * presentation-composition contracts over existing authorities.
 *
 * Governance: this tree is mechanically scanned by governance.test.ts — no
 * console-owned file may import financial persistence/authority writers
 * (protocol-runtime persistence, the durable substrate, gateway command
 * surfaces, authority command modules, or direct DB clients).
 */

export * from './types';
export * from './registry';
export * from './policy';
export * from './environment-context';
export * from './dto';
