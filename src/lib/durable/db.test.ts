/**
 * DEP-003 — durable db path resolution tests (post-closure deployment
 * adaptation: the runtime-state root override).
 *
 * Source of the tested contract: spec/deployment/
 * serverless-runtime-adaptation.md —
 *
 *   PAYSWAP_RUNTIME_DIR, when set to a NON-EMPTY ABSOLUTE path, moves the
 *   DEFAULT durable database location (`var/durable.sqlite`) under that
 *   root; unset, empty, or relative values are INVALID and fail safe to
 *   the documented default (the environment.ts fail-safe pattern — an
 *   invalid value never crashes, it degrades). An explicit
 *   PAYSWAP_DURABLE_DB remains the most-specific override and still wins;
 *   `:memory:` passes through unchanged.
 *
 * Execution split (the repository's recorded convention — bun does not
 * implement node:sqlite, so NO bun suite imports the durable substrate;
 * the hosting bindings suite records the same split): the REAL module
 * runs in a REAL Node child process (the runtime the durable substrate
 * actually runs on in production), every scenario executed in-process
 * there with the documented save/mutate/restore env discipline; this bun
 * suite asserts the returned contract values.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..'); // src/lib/durable → repository root

interface DurableScenario {
  readonly durable: string;
}

interface DurableReport {
  readonly envVarNames: { readonly runtimeRoot: string; readonly durableDb: string };
  readonly defaultPathConst: string;
  readonly scenarios: Record<string, DurableScenario>;
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
 * Evaluate the REAL resolution over the REAL module in a REAL Node child
 * (cwd pinned to the repository root so the default is deterministic).
 * Node >= 23.6 strips types natively; older supported engines (>= 22.13)
 * are retried once with --experimental-strip-types (the test_durable.mjs
 * capability-bootstrap pattern).
 */
function resolveDurablePathsInNode(): DurableReport {
  const script = `
    const serverRuntimeRootEnv = 'PAYSWAP_RUNTIME_DIR';
    const durableDbEnv = 'PAYSWAP_DURABLE_DB';
    const { DEFAULT_DURABLE_DB_PATH, DURABLE_DB_ENV_VAR, RUNTIME_ROOT_ENV_VAR, getDurableDbPath } =
      await import(${JSON.stringify(pathToFileURL(join(HERE, 'db.ts')).href)});
    const setEnv = (runtimeRoot, durableDb) => {
      if (runtimeRoot === undefined) { delete process.env[serverRuntimeRootEnv]; }
      else { process.env[serverRuntimeRootEnv] = runtimeRoot; }
      if (durableDb === undefined) { delete process.env[durableDbEnv]; }
      else { process.env[durableDbEnv] = durableDb; }
    };
    const savedRuntimeRoot = process.env[serverRuntimeRootEnv];
    const savedDurableDb = process.env[durableDbEnv];
    const scenarios = {};
    try {
      setEnv(undefined, undefined);
      scenarios.default = { durable: getDurableDbPath() };
      setEnv('/tmp/payswap-runtime', undefined);
      scenarios.absoluteOverride = { durable: getDurableDbPath() };
      setEnv('', undefined);
      scenarios.empty = { durable: getDurableDbPath() };
      setEnv('   ', undefined);
      scenarios.whitespace = { durable: getDurableDbPath() };
      setEnv('tmp/payswap-runtime', undefined);
      scenarios.relative = { durable: getDurableDbPath() };
      setEnv('/tmp/payswap-runtime', '/tmp/explicit-durable.sqlite');
      scenarios.explicitDurableDbWins = { durable: getDurableDbPath() };
      setEnv('/tmp/payswap-runtime', ':memory:');
      scenarios.memoryPassthrough = { durable: getDurableDbPath() };
    } finally {
      if (savedRuntimeRoot === undefined) { delete process.env[serverRuntimeRootEnv]; }
      else { process.env[serverRuntimeRootEnv] = savedRuntimeRoot; }
      if (savedDurableDb === undefined) { delete process.env[durableDbEnv]; }
      else { process.env[durableDbEnv] = savedDurableDb; }
    }
    process.stdout.write(JSON.stringify({
      envVarNames: { runtimeRoot: RUNTIME_ROOT_ENV_VAR, durableDb: DURABLE_DB_ENV_VAR },
      defaultPathConst: DEFAULT_DURABLE_DB_PATH,
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
      return JSON.parse(result.stdout) as DurableReport;
    }
    lastStderr = String(result.stderr ?? '');
  }
  throw new Error(`node child evaluation of src/lib/durable/db.ts failed: ${lastStderr}`);
}

/** The documented default (pre-adaptation and fail-safe) resolved path. */
const defaultResolvedPath = (): string => join(REPO_ROOT, 'var', 'durable.sqlite');

describe('durable db path resolution (serverless runtime-root adaptation)', () => {
  const report = resolveDurablePathsInNode();

  test('the exported contract names and default path constant are unchanged', () => {
    expect(report.envVarNames.runtimeRoot).toBe('PAYSWAP_RUNTIME_DIR');
    expect(report.envVarNames.durableDb).toBe('PAYSWAP_DURABLE_DB');
    expect(report.defaultPathConst).toBe('var/durable.sqlite');
  });

  test('default resolution is exactly the pre-adaptation path (regression guard)', () => {
    expect(report.scenarios.default?.durable).toBe(defaultResolvedPath());
  });

  test('a NON-EMPTY ABSOLUTE PAYSWAP_RUNTIME_DIR is honored by the durable sqlite path', () => {
    expect(report.scenarios.absoluteOverride?.durable).toBe(
      join('/tmp/payswap-runtime', 'durable.sqlite'),
    );
  });

  test('an empty PAYSWAP_RUNTIME_DIR fails safe to the default', () => {
    expect(report.scenarios.empty?.durable).toBe(defaultResolvedPath());
  });

  test('a whitespace-only PAYSWAP_RUNTIME_DIR fails safe to the default', () => {
    expect(report.scenarios.whitespace?.durable).toBe(defaultResolvedPath());
  });

  test('a RELATIVE PAYSWAP_RUNTIME_DIR is invalid and fails safe to the default', () => {
    expect(report.scenarios.relative?.durable).toBe(defaultResolvedPath());
  });

  test('an explicit PAYSWAP_DURABLE_DB still wins over the runtime root (precedence unchanged)', () => {
    expect(report.scenarios.explicitDurableDbWins?.durable).toBe('/tmp/explicit-durable.sqlite');
  });

  test('the :memory: experiment path passes through unchanged', () => {
    expect(report.scenarios.memoryPassthrough?.durable).toBe(':memory:');
  });
});
