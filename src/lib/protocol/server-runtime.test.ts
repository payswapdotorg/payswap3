/**
 * UI-011 — server runtime dir resolution tests (post-closure deployment
 * adaptation: the runtime-state root override).
 *
 * Source of the tested contract: spec/deployment/
 * serverless-runtime-adaptation.md —
 *
 *   PAYSWAP_RUNTIME_DIR, when set to a NON-EMPTY ABSOLUTE path, moves the
 *   composed runtime's artifact directory (`var/web-runtime`) under that
 *   root; unset, empty, or relative values are INVALID and fail safe to
 *   the documented default `join(process.cwd(), 'var')` (the
 *   environment.ts fail-safe pattern — an invalid value never crashes, it
 *   degrades). The SAME override also moves the durable substrate's
 *   default `var/durable.sqlite` (src/lib/durable/db.ts): both write
 *   roots derive from the ONE runtime root.
 *
 * Execution split (the repository's recorded convention — bun does not
 * implement node:sqlite, so NO bun suite imports the composed runtime or
 * the durable substrate; the hosting bindings suite records the same
 * split): the REAL resolution functions run in a REAL Node child process
 * (the runtime the composed runtime actually runs on in production — the
 * server-runtime module is imported THROUGH the harnesses' ts_resolver),
 * every scenario executed in-process there with the documented
 * save/mutate/restore env discipline; this bun suite asserts the returned
 * contract values.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..'); // src/lib/protocol → repository root
const RESOLVER_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'ts_resolver.mjs')).href;

interface RuntimeScenario {
  readonly root: string;
  readonly dir: string;
  readonly durable: string;
}

interface RuntimeReport {
  readonly envVarName: string;
  readonly scenarios: Record<string, RuntimeScenario>;
}

/**
 * The child environment: the parent's environment minus BOTH override
 * names (the scenarios below set/unset them inside the child) — so the
 * evaluated baseline is hermetic regardless of ambient values.
 */
function childEnvWithoutRuntimeNames(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PAYSWAP_RUNTIME_DIR;
  delete env.PAYSWAP_DURABLE_DB;
  return env;
}

/**
 * Evaluate the REAL resolution over the REAL modules in a REAL Node child
 * (cwd pinned to the repository root so the default is deterministic;
 * ts_resolver registered for the product layer's extensionless/@-aliased
 * imports). Node >= 23.6 strips types natively; older supported engines
 * (>= 22.13) are retried once with --experimental-strip-types (the
 * test_durable.mjs capability-bootstrap pattern).
 */
function resolveRuntimePathsInNode(): RuntimeReport {
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(RESOLVER_URL)});
    const serverRuntime = await import(${JSON.stringify(
      pathToFileURL(join(HERE, 'server-runtime.ts')).href,
    )});
    const durableDb = await import(${JSON.stringify(
      pathToFileURL(join(REPO_ROOT, 'src', 'lib', 'durable', 'db.ts')).href,
    )});
    const snapshot = () => ({
      root: serverRuntime.resolveRuntimeRoot(),
      dir: serverRuntime.resolveRuntimeDir(),
      durable: durableDb.getDurableDbPath(),
    });
    const setEnv = (runtimeRoot, durableDb) => {
      if (runtimeRoot === undefined) { delete process.env.PAYSWAP_RUNTIME_DIR; }
      else { process.env.PAYSWAP_RUNTIME_DIR = runtimeRoot; }
      if (durableDb === undefined) { delete process.env.PAYSWAP_DURABLE_DB; }
      else { process.env.PAYSWAP_DURABLE_DB = durableDb; }
    };
    const savedRuntimeRoot = process.env.PAYSWAP_RUNTIME_DIR;
    const savedDurableDb = process.env.PAYSWAP_DURABLE_DB;
    const scenarios = {};
    try {
      setEnv(undefined, undefined);
      scenarios.default = snapshot();
      setEnv('/tmp/payswap-runtime', undefined);
      scenarios.absoluteOverride = snapshot();
      setEnv('', undefined);
      scenarios.empty = snapshot();
      setEnv('   ', undefined);
      scenarios.whitespace = snapshot();
      setEnv('tmp/payswap-runtime', undefined);
      scenarios.relative = snapshot();
    } finally {
      if (savedRuntimeRoot === undefined) { delete process.env.PAYSWAP_RUNTIME_DIR; }
      else { process.env.PAYSWAP_RUNTIME_DIR = savedRuntimeRoot; }
      if (savedDurableDb === undefined) { delete process.env.PAYSWAP_DURABLE_DB; }
      else { process.env.PAYSWAP_DURABLE_DB = savedDurableDb; }
    }
    process.stdout.write(JSON.stringify({
      envVarName: serverRuntime.RUNTIME_ROOT_ENV_VAR,
      scenarios,
    }));
  `;
  const options = {
    cwd: REPO_ROOT,
    env: childEnvWithoutRuntimeNames(),
    encoding: 'utf8' as const,
  };
  let lastStderr = '';
  for (const flags of [[], ['--experimental-strip-types']]) {
    const result = spawnSync('node', [...flags, '--input-type=module', '-e', script], options);
    if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.length > 0) {
      return JSON.parse(result.stdout) as RuntimeReport;
    }
    lastStderr = String(result.stderr ?? '');
  }
  throw new Error(
    `node child evaluation of src/lib/protocol/server-runtime.ts failed: ${lastStderr}`,
  );
}

/** The documented default (pre-adaptation and fail-safe) runtime dir. */
const defaultRuntimeDir = (): string => join(REPO_ROOT, 'var', 'web-runtime');

describe('server runtime dir resolution (serverless runtime-root adaptation)', () => {
  const report = resolveRuntimePathsInNode();

  test('the exported contract name is PAYSWAP_RUNTIME_DIR', () => {
    expect(report.envVarName).toBe('PAYSWAP_RUNTIME_DIR');
  });

  test('default resolution is exactly the pre-adaptation path (regression guard)', () => {
    expect(report.scenarios.default?.root).toBe(join(REPO_ROOT, 'var'));
    expect(report.scenarios.default?.dir).toBe(defaultRuntimeDir());
    expect(report.scenarios.default?.durable).toBe(join(REPO_ROOT, 'var', 'durable.sqlite'));
  });

  test('a NON-EMPTY ABSOLUTE PAYSWAP_RUNTIME_DIR is honored by the server runtime dir', () => {
    expect(report.scenarios.absoluteOverride?.root).toBe('/tmp/payswap-runtime');
    expect(report.scenarios.absoluteOverride?.dir).toBe(
      join('/tmp/payswap-runtime', 'web-runtime'),
    );
  });

  test('an empty PAYSWAP_RUNTIME_DIR fails safe to the default', () => {
    expect(report.scenarios.empty?.dir).toBe(defaultRuntimeDir());
  });

  test('a whitespace-only PAYSWAP_RUNTIME_DIR fails safe to the default', () => {
    expect(report.scenarios.whitespace?.dir).toBe(defaultRuntimeDir());
  });

  test('a RELATIVE PAYSWAP_RUNTIME_DIR is invalid and fails safe to the default', () => {
    expect(report.scenarios.relative?.dir).toBe(defaultRuntimeDir());
  });

  test('both write roots derive from the ONE runtime root under the override', () => {
    expect(report.scenarios.absoluteOverride?.dir).toBe(
      join('/tmp/payswap-runtime', 'web-runtime'),
    );
    expect(report.scenarios.absoluteOverride?.durable).toBe(
      join('/tmp/payswap-runtime', 'durable.sqlite'),
    );
  });
});
