#!/usr/bin/env node
/**
 * DEP-006 — reproducible build/package evidence (repo-local, zero npm deps).
 *
 * Records two digests into the promotion record's audit trail (append-only
 * JSONL, deploy/promotions/promotion-records.jsonl):
 *
 *   build_output_digest  — content digest over the runtime package
 *       (`.next/standalone/` — server.js + traced node_modules + .next/static
 *       + public, per spec/deployment/packaging.md §1) produced by a FRESH
 *       `bun run build`, with the per-build IDENTITY tokens normalized to
 *       fixed placeholders. Next.js injects random per-build identity
 *       material that is not source-derived; normalizing exactly these
 *       tokens makes the digest a function of the tree alone:
 *         * BUILD_ID (also woven into manifests and asset URLs),
 *         * the prerender identity comment token (`<!DOCTYPE html><!--T-->`)
 *           and the RSC `"b"` build token,
 *         * previewModeId / previewModeSigningKey / previewModeEncryptionKey
 *           (per-build preview-mode crypto material),
 *         * the server-reference-manifest encryptionKey.
 *       "Reproducible build" = same tree digest → same normalized build
 *       digest across two fresh runs in the same environment (run this
 *       script twice and compare).
 *
 *   image_context_digest — digest over the Dockerfile bytes plus the docker
 *       image build context file list: every git-tracked file that passes
 *       the repository `.dockerignore` filter (each as "<path> <sha256>"),
 *       plus the Dockerfile's own sha256. The filter implements the pattern
 *       syntax present in this repository's .dockerignore (comments, plain
 *       names, anchored paths, `*`/`?` globs, directory prefixes); negation
 *       (`!`) patterns are refused fail-closed (none exist today — if one is
 *       ever added, this script must be taught it first).
 *
 * Fail-closed: a missing record id, a failed build, or an unreadable input
 * is an error, never a silent pass. PAYSWAP_ENV=production context is
 * refused (same contract as scripts/promote.mjs — evidence tooling only).
 *
 * Node >= 22.6 (TypeScript type stripping for the frozen
 * src/lib/environment.ts module, imported as a black box).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const RECORDS_FILE = join(ROOT, 'deploy', 'promotions', 'promotion-records.jsonl');
const RECORDS_REL = 'deploy/promotions/promotion-records.jsonl';
const STANDALONE_DIR = join(ROOT, '.next', 'standalone');
const BUILD_ID_FILE = join(STANDALONE_DIR, 'payswap3', '.next', 'BUILD_ID');
const DOCKERFILE = join(ROOT, 'Dockerfile');
const DOCKERIGNORE = join(ROOT, '.dockerignore');
const ENVIRONMENT_TS = join(ROOT, 'src', 'lib', 'environment.ts');

const TOOL_NAME = 'scripts/package_snapshot.mjs';
const SCHEMA_VERSION = 1;

function fail(message, code = 1) {
  process.stderr.write(`${TOOL_NAME}: FAIL — ${message}\n`);
  process.exit(code);
}

function out(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`);
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// The per-build identity-token normalization (see the header comment).
// ---------------------------------------------------------------------------
const RE_DOCTYPE_TOKEN = /<!DOCTYPE html><!--[A-Za-z0-9_-]{16,32}-->/g;
// matches "b":"TOKEN" and \"b\":\"TOKEN\" (the RSC build identity token)
const RE_B_TOKEN = /(\\?"b\\?":\s*\\?")[A-Za-z0-9_-]{16,32}/g;
// matches "previewModeId": "hex" plus the Signing/EncryptionKey variants
const RE_PREVIEW_KEY =
  /(\\?"previewMode(Id|SigningKey|EncryptionKey)\\?":\s*\\?")[0-9a-f]{32,64}/g;
// matches "encryptionKey": "b64" and encryptionKey\": \"b64\"
const RE_ENC_KEY = /(encryptionKey\\?":\s*\\?")[A-Za-z0-9+/=]{30,60}/g;

const NORMALIZATION_DESCRIPTION =
  'per-build identity tokens normalized to fixed placeholders: BUILD_ID (incl. its woven occurrences in manifests/asset URLs), the prerender identity comment token and the RSC "b" build token, previewModeId/previewModeSigningKey/previewModeEncryptionKey, and the server-reference-manifest encryptionKey — none are source-derived';

function normalizeText(text, buildId) {
  let t = text;
  if (buildId) {
    t = t.split(buildId).join('<BUILDID>');
  }
  t = t.replace(RE_DOCTYPE_TOKEN, '<!DOCTYPE html><!--<BUILDID>-->');
  t = t.replace(RE_B_TOKEN, '$1<BUILDID>');
  t = t.replace(RE_PREVIEW_KEY, '$1<PREVIEWKEY>');
  t = t.replace(RE_ENC_KEY, '$1<ENCKEY>');
  return t;
}

// ---------------------------------------------------------------------------
// Digest over the standalone runtime package.
// ---------------------------------------------------------------------------
function digestStandalone() {
  if (!existsSync(BUILD_ID_FILE)) {
    fail(
      `${BUILD_ID_FILE} is missing — run the build first (the gate runner's build gate or this script's own fresh build)`,
    );
  }
  const buildId = readFileSync(BUILD_ID_FILE, 'utf8').trim();
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else {
        files.push(p);
      }
    }
  })(STANDALONE_DIR);
  files.sort();
  const combined = createHash('sha256');
  let normalizedCount = 0;
  for (const file of files) {
    const rel = relative(STANDALONE_DIR, file);
    const raw = readFileSync(file);
    let buf = raw;
    const asText = raw.toString('utf8');
    const normalized = normalizeText(asText, buildId);
    if (normalized !== asText) {
      buf = Buffer.from(normalized, 'utf8');
      normalizedCount += 1;
    }
    combined.update(`${rel}\0${sha256(buf)}\n`, 'utf8');
  }
  return {
    digest: combined.digest('hex'),
    fileCount: files.length,
    normalizedFileCount: normalizedCount,
    buildIdLength: buildId.length,
  };
}

// ---------------------------------------------------------------------------
// The docker image build context (tracked files passing .dockerignore).
// ---------------------------------------------------------------------------
function parseDockerignore() {
  if (!existsSync(DOCKERIGNORE)) {
    fail('.dockerignore is missing on disk');
  }
  const patterns = [];
  for (const [index, rawLine] of readFileSync(DOCKERIGNORE, 'utf8').split('\n').entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('!')) {
      fail(
        `.dockerignore line ${index + 1} uses negation (${line}) — this script's ` +
          'context filter does not support negation patterns; teach it first (fail-closed)',
      );
    }
    patterns.push(line);
  }
  return patterns;
}

/** Glob match for one path segment pattern (* and ?). */
function globToRegExp(pattern) {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Dockerignore semantics for the pattern syntax in this repository:
 *  - a pattern containing '/' is anchored to the context root (and a
 *    trailing '/' makes it a directory prefix);
 *  - a pattern without '/' matches that name at any depth — as a file
 *    basename (e.g. `*.log`, `.env`) or as a directory name, in which case
 *    everything under it is excluded too (e.g. `spec`, `node_modules`).
 */
function dockerignoreMatcher(patterns) {
  const rules = patterns.map((pattern) => {
    const dirOnly = pattern.endsWith('/');
    const body = dirOnly ? pattern.slice(0, -1) : pattern;
    const anchored = body.includes('/');
    return { dirOnly, anchored, regex: globToRegExp(body), body };
  });
  return function excluded(path) {
    const segments = path.split('/');
    for (const rule of rules) {
      if (rule.anchored) {
        if (rule.regex.test(path)) {
          return true;
        }
        if (rule.dirOnly && path.startsWith(rule.body + '/')) {
          return true;
        }
      } else if (segments.some((segment) => rule.regex.test(segment))) {
        return true;
      }
    }
    return false;
  };
}

function digestImageContext() {
  const child = spawnSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
  });
  if (child.error || child.status !== 0) {
    fail('git ls-files failed');
  }
  const tracked = child.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0)
    .sort();
  const excluded = dockerignoreMatcher(parseDockerignore());
  const contextFiles = tracked.filter((p) => !excluded(p));
  if (contextFiles.length === 0) {
    fail('the computed docker image build context is empty (fail-closed)');
  }
  const dockerfileSha = sha256(readFileSync(DOCKERFILE));
  const combined = createHash('sha256');
  combined.update(`Dockerfile\0${dockerfileSha}\n`, 'utf8');
  for (const rel of contextFiles) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      fail(`tracked file missing on disk: ${rel}`);
    }
    combined.update(`${rel}\0${sha256(readFileSync(abs))}\n`, 'utf8');
  }
  return {
    digest: combined.digest('hex'),
    fileCount: contextFiles.length,
    dockerfileSha,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const recordId = process.argv[2];
  if (!recordId) {
    fail(
      'usage: node scripts/package_snapshot.mjs <record-id> (a promotion record id is required — fail-closed)',
    );
  }
  if (!existsSync(RECORDS_FILE)) {
    fail(`${RECORDS_REL} does not exist`);
  }
  const records = readFileSync(RECORDS_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`${RECORDS_REL} line ${index + 1} does not parse: ${error.message}`);
      }
    });
  const record = records.find(
    (entry) => entry.type === 'promotion-record' && entry.record_id === recordId,
  );
  if (!record) {
    fail(`promotion record not found: ${recordId} (searched ${RECORDS_REL})`);
  }

  // The frozen environment contract, imported as a black box (F1).
  const environmentModule = await import(pathToFileURL(ENVIRONMENT_TS).href);
  const resolved = environmentModule.getEnvironment();
  if (resolved === 'production') {
    fail(
      'PAYSWAP_ENV resolves to production: evidence tooling refuses the production context (production deployment binding is FUTURE-WORK; the production_gate contract stays authoritative)',
      2,
    );
  }

  // A FRESH build — the evidence is "two fresh runs", never a stale artifact.
  process.stderr.write(`${TOOL_NAME}: fresh build (bun run build)\n`);
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (build.error || build.status !== 0) {
    fail(`bun run build failed: ${build.error ? build.error.message : build.stderr || build.stdout}`);
  }

  const standalone = digestStandalone();
  const imageContext = digestImageContext();

  const entry = {
    type: 'build-evidence',
    schema_version: SCHEMA_VERSION,
    evidence_id: `bld-${Date.now()}-${recordId}`,
    record_id: recordId,
    created_at: new Date().toISOString(),
    build: {
      command: 'bun run build',
      exit: 0,
      scope: '.next/standalone (the runtime package per spec/deployment/packaging.md §1)',
    },
    build_output_digest: standalone.digest,
    build_output_files: standalone.fileCount,
    build_output_normalized_files: standalone.normalizedFileCount,
    identity_token_normalization: NORMALIZATION_DESCRIPTION,
    reproducibility_contract:
      'same tree digest → same normalized build digest across two fresh runs in the same environment; run this script twice and compare',
    image_context_digest: imageContext.digest,
    image_context_files: imageContext.fileCount,
    image_context_basis:
      'Dockerfile sha256 + every git-tracked file passing the repository .dockerignore filter, each as "<path> <sha256>" (the docker build context)',
  };
  // Append-only audit trail.
  const { appendFileSync } = await import('node:fs');
  appendFileSync(RECORDS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');

  out({
    ok: true,
    action: 'package-snapshot',
    record_id: recordId,
    build_output_digest: standalone.digest,
    build_output_files: standalone.fileCount,
    build_output_normalized_files: standalone.normalizedFileCount,
    image_context_digest: imageContext.digest,
    image_context_files: imageContext.fileCount,
    appended_to: RECORDS_REL,
  });
  process.stderr.write(
    `${TOOL_NAME}: build-evidence for ${recordId} — build_output_digest=${standalone.digest.slice(0, 16)}… ` +
      `(${standalone.fileCount} files, ${standalone.normalizedFileCount} normalized) ` +
      `image_context_digest=${imageContext.digest.slice(0, 16)}… (${imageContext.fileCount} context files)\n`,
  );
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
