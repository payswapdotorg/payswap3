/**
 * RTN-011 — The single-writer boundary review (bun suite).
 *
 * The acceptance: "No module other than the transition path mutates
 * authoritative state — boundary review" (RTN-011.md line 23) and "The
 * single-writer boundary review explicitly includes the rails surface:
 * no adapter-interface code path creates or mutates RailAdapter/
 * RailOperation state; the rails state machines advance only through the
 * transition path (rtn-plan-rulings.md Q1 ruling, delta 1)"
 * (RTN-011.md line 26).
 *
 * The review is machine-checked here as source-structure scans over the
 * repository tree, mirroring the merged rails precedent
 * (rails/adapters.test.ts's import-specifier scan):
 *
 *   (a) the rails ADAPTER INTERFACE (rails/adapters.ts) imports no
 *       authority/store/persistence/runtime module — the adapter
 *       interface cannot reach protocol state (Q1/delta 1);
 *   (b) the scheduler wiring (hosting/scheduler-wiring.ts) imports no
 *       authority module — "owns timing only, never mutates
 *       authoritative state" (the scheduler boundary);
 *   (c) the transition core (transition/*.ts, excluding the test double
 *       and tests) imports src/lib/durable ONLY as type-only imports —
 *       the substrate is integrated through register()/enqueue/db API,
 *       never modified (the work order's forbidden-surface rule);
 *   (d) hosting/durable-binding.ts is the ONLY RTN-011 module that
 *       value-imports the substrate barrel or the per-domain
 *       persistence bridges (the Node/server composition point);
 *   (e) NO file under src/app/ or src/components/ imports any
 *       protocol-runtime authority — the product tier never mutates
 *       authoritative state (the web/API boundary's "no financial
 *       authority");
 *   (f) no RTN-011 module value-imports src/lib/durable/db.ts directly
 *       (the db API is reached through the substrate runtime's own
 *       documented surface).
 *
 * Spec sources (binding): spec/deployment/topology.md line 188
 * ("mutated only by transition-runtime through protocol-owned
 * transitions — no other layer may mutate it directly"); line 130 (the
 * web boundary "never writes authoritative state"); lines 156-157 + 217
 * (the scheduler boundary); rtn-plan-rulings.md Q1, delta 1; RTN-011.md
 * lines 23, 26; spec/protocol-runtime-work-orders/README.md (shared
 * forbidden surfaces: src/lib/durable/ is "read-only integration").
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const RUNTIME_DIR = join(REPO_ROOT, 'src', 'lib', 'protocol-runtime');
const TRANSITION_DIR = join(RUNTIME_DIR, 'transition');
const HOSTING_DIR = join(RUNTIME_DIR, 'hosting');

function readModule(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
}

function walk(dir: string, visitor: (filePath: string) => void): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      walk(fullPath, visitor);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      visitor(fullPath);
    }
  }
}

const AUTHORITY_MODULE_PATTERN =
  /\/(intent|reservations|obligations|settlement|clearing|netting|queues|liquidity|credit|risk|rails|policy|capability)\//;

describe('single-writer boundary review: the rails surface (Q1 ruling, delta 1)', () => {
  test('(a) the adapter interface (rails/adapters.ts) cannot reach protocol state', () => {
    const source = readModule('src/lib/protocol-runtime/rails/adapters.ts');
    const specifiers = importSpecifiers(source);
    // The adapter interface imports ONLY its own domain's types and the
    // payload canon (the merged machine-checked boundary, re-asserted by
    // this item's review).
    for (const specifier of specifiers) {
      expect(specifier === './types.ts' || specifier === './payload.ts').toBe(true);
    }
    // And the interface surface is transmission-and-reporting only.
    expect(source).toContain('transmit(request: RailTransmissionRequest): RailTransmissionOutcome');
    expect(source).toContain('fetchReport(idempotencyKey: string): RailReportEnvelope');
    // No authority, store, or persistence symbol appears in the module.
    for (const forbidden of ['RailAdapterAuthority', 'RailsStore', 'openRailsStore', 'ReconciliationAuthority']) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  test('(a-cont) the adapter interface never names a state-mutating command', () => {
    const source = readModule('src/lib/protocol-runtime/rails/adapters.ts');
    for (const forbidden of [
      'authorizeOperation',
      'registerAdapter',
      'activateAdapter',
      'submitRailOperation(operationId',
      'recordReport',
      'resolveOperationFromUnknown',
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });
});

describe('single-writer boundary review: the scheduler wiring', () => {
  test('(b) the wiring imports no authority module — timing only', () => {
    const source = readFileSync(join(HOSTING_DIR, 'scheduler-wiring.ts'), 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const isKernel = specifier.startsWith('../kernel/');
      const isSubstrateScheduler = specifier === '../../durable/scheduler.ts';
      expect(isKernel || isSubstrateScheduler).toBe(true);
    }
  });
});

describe('single-writer boundary review: the substrate is integrated, never modified', () => {
  test('(c) the transition core imports src/lib/durable only as type-only imports', () => {
    for (const entry of readdirSync(TRANSITION_DIR)) {
      if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) {
        continue;
      }
      const source = readFileSync(join(TRANSITION_DIR, entry), 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.includes('/durable/')) {
          // Only type-only imports of the substrate contract are allowed.
          const typeOnlyPattern = new RegExp(`import type[\\s\\S]*?from '${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
          expect(typeOnlyPattern.test(source)).toBe(true);
        }
      }
    }
  });

  test('(d) durable-binding.ts is the only RTN-011 module that value-imports the substrate or persistence bridges', () => {
    const rtn011Modules: string[] = [];
    walk(TRANSITION_DIR, (filePath) => {
      if (!filePath.endsWith('.test.ts') && !filePath.endsWith('.d.ts')) {
        rtn011Modules.push(filePath);
      }
    });
    walk(HOSTING_DIR, (filePath) => {
      if (!filePath.endsWith('.test.ts') && !filePath.endsWith('.d.ts')) {
        rtn011Modules.push(filePath);
      }
    });
    expect(rtn011Modules.length).toBeGreaterThan(0);
    for (const modulePath of rtn011Modules) {
      const source = readFileSync(modulePath, 'utf8');
      const specifiers = importSpecifiers(source);
      const valueImportsDurableBarrel = specifiers.some(
        (specifier) => specifier.endsWith('/durable/index.ts'),
      );
      const valueImportsPersistence = specifiers.some((specifier) =>
        /\/(intent|reservations|obligations|settlement|clearing|netting|queues|liquidity|credit|risk)\/persistence\.ts$/.test(
          specifier,
        ),
      );
      const isDurableBinding = modulePath.endsWith('durable-binding.ts');
      if (valueImportsDurableBarrel || valueImportsPersistence) {
        expect(isDurableBinding).toBe(true);
      }
    }
  });

  test('(f) the durable db API is reached only through the composition point', () => {
    // The work order's integration rule: "integration via register()/
    // enqueue/db API only" — the db API IS a permitted public surface, and
    // exactly ONE module reaches it directly: hosting/durable-binding.ts
    // (the Node/server composition point). Every other RTN-011 module
    // touches the substrate only through the type-only structural port
    // (transition/substrate-port.ts).
    const modules: string[] = [];
    walk(TRANSITION_DIR, (filePath) => {
      if (!filePath.endsWith('.test.ts') && !filePath.endsWith('.d.ts')) {
        modules.push(filePath);
      }
    });
    walk(HOSTING_DIR, (filePath) => {
      if (!filePath.endsWith('.test.ts') && !filePath.endsWith('.d.ts')) {
        modules.push(filePath);
      }
    });
    for (const modulePath of modules) {
      const source = readFileSync(modulePath, 'utf8');
      const directDbImport = [...source.matchAll(/from '([^']*durable\/db\.ts)'/g)].length > 0;
      if (!directDbImport) {
        continue;
      }
      const isCompositionPoint = modulePath.endsWith('durable-binding.ts');
      if (!isCompositionPoint) {
        // Outside the composition point, only the type-only form is
        // permitted.
        const typeOnly = /import type[\s\S]*?from '[^']*durable\/db\.ts/.test(source);
        expect(typeOnly).toBe(true);
      }
    }
  });
});

describe('single-writer boundary review: the product tier never mutates authoritative state', () => {
  test('(e) no src/app or src/components file imports a protocol-runtime authority', () => {
    const offenders: string[] = [];
    for (const productDir of ['src/app', 'src/components']) {
      walk(join(REPO_ROOT, productDir), (filePath) => {
        const source = readFileSync(filePath, 'utf8');
        for (const specifier of importSpecifiers(source)) {
          if (
            specifier.includes('protocol-runtime/') &&
            AUTHORITY_MODULE_PATTERN.test(specifier) &&
            !specifier.includes('/types')
          ) {
            offenders.push(`${filePath}: ${specifier}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('(e-cont) the product ports surface (src/lib/protocol) imports no protocol-runtime authority', () => {
    const offenders: string[] = [];
    walk(join(REPO_ROOT, 'src', 'lib', 'protocol'), (filePath) => {
      const source = readFileSync(filePath, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.includes('protocol-runtime/')) {
          offenders.push(`${filePath}: ${specifier}`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('single-writer boundary review: the transition path is the only external authority driver', () => {
  test('(g) authority classes are imported outside their own domains only as types — the merged compositions and the transition path included', () => {
    // The authoritative-state mutators are the authorities' own command
    // methods. Outside each authority's own domain, a module may REFERENCE
    // an authority/ledger class only as a TYPE: a type-only import can
    // neither construct an authority nor call a mutating command, so the
    // single-writer discipline holds. This admits exactly two classes of
    // cross-domain reference:
    //   - the merged, spec-mandated compositions (liquidity/credit take
    //     the area-5 ReservationLedger type — INV-6-2: "position
    //     transitions occur only via the area 5 serialized ledger");
    //   - the RTN-011 transition path (hosting/bindings.ts,
    //     hosting/durable-binding.ts), which drives INJECTED authority
    //     instances — composed by the harness/server — through the
    //     command execution path, and never constructs or reaches into an
    //     authority itself.
    const offenders: string[] = [];
    walk(RUNTIME_DIR, (filePath) => {
      const relative = filePath.slice(REPO_ROOT.length + 1);
      if (relative.endsWith('.test.ts') || relative.endsWith('.d.ts')) {
        return;
      }
      const segments = relative.split('/');
      // e.g. src/lib/protocol-runtime/<domain>/<file>.ts — the file's own
      // domain is the 4th segment.
      const fileDomain = segments.length > 4 ? segments[3] : null;
      const source = readFileSync(filePath, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        const match = /\.\.?\/(intent|reservations|obligations|settlement|clearing|netting|queues|liquidity|credit|risk|rails)\/(authority|ledger|store)\.ts$/.exec(
          specifier,
        );
        if (!match) {
          continue;
        }
        const targetDomain = match[1] ?? '';
        if (targetDomain === fileDomain) {
          continue; // the authority's own domain composes itself
        }
        // Outside the own domain the import must be TYPE-ONLY.
        const typeOnlyPattern = new RegExp(
          `import type[\\s\\S]*?from '${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\$&')}'`,
        );
        if (!typeOnlyPattern.test(source)) {
          offenders.push(`${relative}: ${specifier} (must be a type-only import outside its own domain)`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});
