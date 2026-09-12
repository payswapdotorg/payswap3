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

  test('(e-cont, amended by UI-011) the product ports surface (src/lib/protocol) imports protocol-runtime ONLY through the sanctioned port-adapter modules', () => {
    // UI-011 — the sanctioned product splice (rtn-plan-rulings.md
    // Q5/delta 6; the gateway boundary test's splice guard is the work
    // order's named amendment target, and this hosting-suite check guards
    // the SAME pre-splice invariant, so the splice amends both honestly):
    // the port adapter modules, the server-side composition root, the
    // runtime handle, the adapter-boundary constants, the intent port's
    // runtime-vocabulary re-export, and the product adapter tests are
    // EXACTLY the sanctioned importers. Nothing else under
    // src/lib/protocol/ imports protocol-runtime, and (e) above keeps
    // src/app/ + src/components/ clean of authority imports entirely.
    const SANCTIONED_PRODUCT_ADAPTER_FILES = new Set([
      'adapter-boundary.ts',
      'runtime-handle.ts',
      'runtime-intent-adapter.ts',
      'runtime-checkout-adapter.ts',
      'runtime-capability-adapter.ts',
      'runtime-tracking-adapter.ts',
      'runtime-waiting-adapter.ts',
      'runtime-liquidity-adapter.ts',
      'runtime-mediation-adapter.ts',
      'server-runtime.ts',
      'intent-port.ts',
      'runtime-intent-adapter.test.ts',
      'runtime-checkout-adapter.test.ts',
      'runtime-capability-adapter.test.ts',
      'runtime-tracking-adapter.test.ts',
      'runtime-waiting-adapter.test.ts',
      'runtime-liquidity-adapter.test.ts',
      'runtime-mediation-adapter.test.ts',
      'product-adapter-test-compose.ts',
    ]);
    const offenders: string[] = [];
    walk(join(REPO_ROOT, 'src', 'lib', 'protocol'), (filePath) => {
      const fileName = filePath.split('/').pop() ?? '';
      if (SANCTIONED_PRODUCT_ADAPTER_FILES.has(fileName)) {
        return;
      }
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
    // single-writer discipline holds. This admits exactly three classes of
    // cross-domain reference:
    //   - the merged, spec-mandated compositions (liquidity/credit take
    //     the area-5 ReservationLedger type — INV-6-2: "position
    //     transitions occur only via the area 5 serialized ledger");
    //   - the RTN-011 transition path (hosting/bindings.ts,
    //     hosting/durable-binding.ts), which drives INJECTED authority
    //     instances — composed by the harness/server — through the
    //     command execution path, and never constructs or reaches into an
    //     authority itself;
    //   - the RTN-012 wave barrel (src/lib/protocol-runtime/index.ts —
    //     work order RTN-012's owned surface), which RE-EXPORTS the
    //     composed public surface. A re-export is a value import by
    //     necessity (a class cannot be re-exported type-only), but the
    //     barrel constructs nothing, calls no command, and reaches no
    //     substrate: check (h) below mechanically enforces exactly that,
    //     so the exception is scoped to the barrel's single path and
    //     carries its own stronger gate (added by the RTN-012 integration
    //     item — the review learns the wave's composition root).
    const offenders: string[] = [];
    walk(RUNTIME_DIR, (filePath) => {
      const relative = filePath.slice(REPO_ROOT.length + 1);
      if (relative.endsWith('.test.ts') || relative.endsWith('.d.ts')) {
        return;
      }
      if (relative === 'src/lib/protocol-runtime/index.ts') {
        return; // the RTN-012 wave barrel — gated by check (h) instead
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

  test('(h) the RTN-012 wave barrel is a pure re-export composition root — no construction, no authority command, no substrate reach', () => {
    // The wave barrel (src/lib/protocol-runtime/index.ts — RTN-012's
    // owned surface) re-exports the composed public surface. The
    // single-writer discipline holds through it because the barrel
    // EXECUTES nothing: it constructs no authority, calls no command, and
    // never reaches the substrate. This check mechanically enforces the
    // (g) exception's conditions: the module body is exactly its export
    // statements.
    //
    // Spec sources: spec/protocol-runtime-work-orders/RTN-012.md (the
    // wave-barrel owned surface); spec/deployment/topology.md line 188
    // (the single-writer rule the barrel must not disturb);
    // rtn-plan-rulings.md Q3 (the in-process composed form's enforced
    // module boundaries).
    const barrelPath = join(RUNTIME_DIR, 'index.ts');
    if (!existsSync(barrelPath)) {
      return; // not materialized in this tree
    }
    const source = readFileSync(barrelPath, 'utf8');
    // Strip block and line comments; the barrel must consist ONLY of
    // re-export statements (`export ... from '...'` / `export type ...
    // from '...'`) — nothing else executes.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const statements = code
      .split(';')
      .map((statement) => statement.replace(/\s+/g, ' ').trim())
      .filter((statement) => statement.length > 0);
    expect(statements.length).toBeGreaterThan(0);
    const nonReExports = statements.filter(
      (statement) => !(statement.startsWith('export ') && statement.includes(" from '")),
    );
    expect(nonReExports).toEqual([]);
    // No substrate reach (the register()/enqueue integration rule — the
    // barrel never bypasses the transition path), no construction, and no
    // authority-command call site.
    expect(source.includes('../../durable/')).toBe(false);
    expect(/\bnew\s+[A-Z]/.test(code)).toBe(false);
  });
});
