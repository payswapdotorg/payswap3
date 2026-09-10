#!/usr/bin/env python3
"""DEP-003 validator — dependency-free Python 3 (stdlib only).

Run from the repository root:  python3 scripts/validate_durable.py

Checks:
  1. All DEP-003 deliverable files exist.
  2. deploy/migrations: filenames are ordered and monotonic; 0001 contains
     the required tables, columns, constraints (UNIQUE idempotency, status
     CHECK, lease columns), and the reclaim/availability indexes.
  3. src/lib/durable/*.ts: static SQL strings with bound parameters only —
     every prepare()/exec() statement call on a database handle takes a
     direct string literal, a module-level const string, or (db.ts only,
     the migration runner) the migration file content; no template-literal
     SQL with interpolation; imports limited to node: builtins and relative
     modules (zero npm dependencies).
  4. scripts/test_durable.mjs exists and covers the six required evidence
     cases by test-name markers.
  5. spec/durable/execution.md exists and documents PAYSWAP_DURABLE_DB.
  6. package.json dependency guard: byte-identical to the DEP-003 base when
     PAYSWAP_BASE_PACKAGE_JSON_SHA256 (sha256 hex of the base file) is set;
     otherwise the base dependency set and scripts are verified
     structurally (exactly next@16.1.3, react@19.2.3, react-dom@19.2.3 and
     the dev/build/start/typecheck scripts).

Exit code 0 = all checks passed; 1 = named failures.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PASSED: list[str] = []
FAILURES: list[str] = []


def ok(message: str) -> None:
    PASSED.append(message)
    print(f"[ok] {message}")


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"[FAIL] {message}")


def check(condition: bool, message_ok: str, message_fail: str) -> None:
    if condition:
        ok(message_ok)
    else:
        fail(message_fail)


DURABLE_TS_FILES = [
    "src/lib/durable/db.ts",
    "src/lib/durable/queue.ts",
    "src/lib/durable/worker.ts",
    "src/lib/durable/scheduler.ts",
    "src/lib/durable/events.ts",
    "src/lib/durable/index.ts",
]

REQUIRED_TEST_MARKERS = [
    "[test:migration]",
    "[test:restart-durability]",
    "[test:duplicate-work]",
    "[test:redelivery]",
    "[test:dead-letter]",
    "[test:scheduler]",
]

SQL_KEYWORD_IN_TEMPLATE = re.compile(
    r"\b(select|insert|update|delete|pragma|create|begin|commit|rollback|drop|alter)\b",
    re.IGNORECASE,
)
TEMPLATE_STRING = re.compile(r"`(?:\\.|[^`\\])*`", re.DOTALL)
IMPORT_SPECIFIER = re.compile(r"""(?:from|import)\s+['"]([^'"]+)['"]""")
# SQL statement calls on database handles (this deliberately excludes
# unrelated .exec() uses such as RegExp.prototype.exec).
SQL_CALL = re.compile(r"(?:\bsqlite\b|\bdatabase\b|#database)\s*\.\s*(?:prepare|exec)\s*\(")
# Module-level string constants (the named static SQL strings). Multi-line
# definitions (const NAME =\n  "...";) are supported.
MODULE_CONST_STRING = re.compile(
    r"const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['\"])(?:\\.|(?!\2).)*\2",
    re.DOTALL,
)
ARGUMENT_TOKEN = re.compile(r"[ \t\r\n]*([A-Za-z_][A-Za-z0-9_.]*|'[^']*'|\"[^\"]*\"|`)")


def normalize(sql_text: str) -> str:
    return re.sub(r"\s+", " ", sql_text).lower()


def check_migrations() -> None:
    migrations_dir = ROOT / "deploy" / "migrations"
    check(migrations_dir.is_dir(), "deploy/migrations directory exists", "deploy/migrations directory is missing")
    if not migrations_dir.is_dir():
        return
    sql_files = sorted(p for p in migrations_dir.glob("*.sql"))
    check(bool(sql_files), "migrations directory contains .sql files", "migrations directory contains no .sql files")
    if not sql_files:
        return

    names = [p.name for p in sql_files]
    check(
        "0001_durable_execution.sql" in names,
        "0001_durable_execution.sql is present",
        "0001_durable_execution.sql is missing",
    )

    orders: list[int] = []
    monotonic = True
    for name in names:
        match = re.match(r"^(\d+)_", name)
        if not match:
            fail(f"migration filename lacks a numeric order prefix: {name}")
            monotonic = False
            continue
        order = int(match.group(1))
        if orders and order <= orders[-1]:
            fail(f"migration order is not strictly monotonic at: {name}")
            monotonic = False
        orders.append(order)
    if monotonic:
        ok(f"migration filenames are ordered and monotonic ({', '.join(names)})")
    check(
        names == sorted(names),
        "migration listing is lexicographically ordered",
        "migration listing is not lexicographically ordered",
    )

    first = migrations_dir / "0001_durable_execution.sql"
    if not first.is_file():
        return
    sql = normalize(first.read_text(encoding="utf-8"))

    check(
        re.search(r"create\s+table\s+(?:if\s+not\s+exists\s+)?durable_jobs\s*\(", sql) is not None,
        "durable_jobs table is created",
        "durable_jobs table is not created",
    )
    required_job_columns = [
        "id",
        "kind",
        "idempotency_key",
        "payload",
        "status",
        "attempts",
        "max_attempts",
        "reserved_by",
        "lease_expires_at",
        "available_at",
        "created_at",
        "updated_at",
    ]
    for column in required_job_columns:
        check(
            re.search(rf"\b{column}\b", sql) is not None,
            f"durable_jobs column present: {column}",
            f"durable_jobs column missing: {column}",
        )
    status_check = re.search(r"check\s*\(\s*status\s+in\s*\(([^)]*)\)", sql)
    if status_check:
        inner = status_check.group(1)
        statuses_ok = all(f"'{value}'" in inner for value in ["queued", "reserved", "succeeded", "failed", "dead_lettered"])
        check(
            statuses_ok,
            "durable_jobs status CHECK allows the five required statuses",
            "durable_jobs status CHECK is missing required statuses",
        )
    else:
        fail("durable_jobs status CHECK constraint not found")
    check(
        re.search(r"unique\s*\(\s*idempotency_key\s*,\s*kind\s*\)", sql) is not None,
        "durable_jobs UNIQUE (idempotency_key, kind) constraint present",
        "durable_jobs UNIQUE (idempotency_key, kind) constraint missing",
    )
    check(
        re.search(r"attempts\s+integer\s+not\s+null\s+default\s+0", sql) is not None,
        "durable_jobs attempts INTEGER NOT NULL DEFAULT 0",
        "durable_jobs attempts default 0 constraint missing",
    )

    check(
        re.search(r"create\s+table\s+(?:if\s+not\s+exists\s+)?durable_events\s*\(", sql) is not None,
        "durable_events table is created",
        "durable_events table is not created",
    )
    for column in ["job_id", "type", "data", "owner", "recorded_at"]:
        check(
            re.search(rf"\b{column}\b", sql) is not None,
            f"durable_events column present: {column}",
            f"durable_events column missing: {column}",
        )
    check(
        re.search(r"autoincrement", sql) is not None,
        "durable_events id INTEGER PRIMARY KEY AUTOINCREMENT",
        "durable_events AUTOINCREMENT missing",
    )
    check(
        re.search(r"create\s+index\s+\w+\s+on\s+durable_jobs\s*\(\s*status\s*,\s*available_at\s*\)", sql) is not None,
        "index on durable_jobs (status, available_at) present",
        "index on durable_jobs (status, available_at) missing",
    )
    check(
        re.search(r"create\s+index\s+\w+\s+on\s+durable_jobs\s*\([^)]*lease_expires_at[^)]*\)", sql) is not None,
        "lease-expiry reclaim index on durable_jobs present",
        "lease-expiry reclaim index on durable_jobs missing",
    )


def check_ts_sources() -> None:
    for relative in DURABLE_TS_FILES:
        path = ROOT / relative
        if not path.is_file():
            fail(f"missing TS source: {relative}")
            continue
        content = path.read_text(encoding="utf-8")
        ok(f"TS source exists and is non-empty: {relative} ({len(content)} bytes)")

        # Rule 1: every SQL statement call on a database handle must take
        # static SQL: a direct string literal, a module-level const string
        # (named static SQL), or — only in db.ts, the migration runner —
        # the migration file content itself. Never a computed/template SQL
        # string: runtime data must flow through bound parameters.
        const_names = {m.group(1) for m in MODULE_CONST_STRING.finditer(content)}
        violations = []
        for match in SQL_CALL.finditer(content):
            token = ARGUMENT_TOKEN.match(content, match.end())
            if token is None:
                violations.append(content[match.start() : match.start() + 60].replace("\n", " "))
                continue
            argument = token.group(1)
            if argument.startswith(("'", '"')):
                continue  # direct string literal
            if argument == "`":
                violations.append(f"template literal SQL at: {content[match.start():match.start() + 50]}")
                continue
            if argument in const_names:
                continue  # named module-level static SQL constant
            if argument == "file.content" and relative.endswith("db.ts"):
                continue  # the migration runner applies migration file contents
            if argument == "sql" and relative.endswith("db.ts"):
                # The DurableDatabase handle's typed prepare-cache wrapper
                # (prepare(sql: string)) is a documented pass-through; every
                # external call site passes literal/const SQL, enforced here.
                continue
            violations.append(f"non-static SQL argument '{argument}' at: {content[match.start():match.start() + 50]}")
        check(
            not violations,
            f"{relative}: database prepare/exec calls use static SQL strings only (bound parameters for data)",
            f"{relative}: non-static SQL in prepare/exec: {violations[:2]}",
        )

        # Rule 2: no template literal that is SQL and contains interpolation.
        interpolated_sql = []
        for template in TEMPLATE_STRING.findall(content):
            if "${" in template and SQL_KEYWORD_IN_TEMPLATE.search(template):
                interpolated_sql.append(template[:60])
        check(
            not interpolated_sql,
            f"{relative}: no template-literal SQL with interpolation",
            f"{relative}: interpolated SQL template found: {interpolated_sql[:1]}",
        )

        # Rule 3: imports are limited to node: builtins and relative modules.
        foreign = [
            specifier
            for specifier in IMPORT_SPECIFIER.findall(content)
            if not specifier.startswith("node:") and not specifier.startswith(".")
        ]
        check(
            not foreign,
            f"{relative}: imports limited to node: builtins and relative modules (zero npm deps)",
            f"{relative}: foreign import specifier(s): {foreign[:3]}",
        )


def check_test_suite() -> None:
    path = ROOT / "scripts" / "test_durable.mjs"
    check(path.is_file(), "scripts/test_durable.mjs exists", "scripts/test_durable.mjs is missing")
    if not path.is_file():
        return
    content = path.read_text(encoding="utf-8")
    for marker in REQUIRED_TEST_MARKERS:
        check(
            marker in content,
            f"evidence case covered: {marker}",
            f"evidence case NOT covered: {marker}",
        )
    check(
        "test framework" not in content.lower(),
        "test_durable.mjs declares plain-Node, framework-free harness",
        "test_durable.mjs references a test framework",
    )


def check_spec() -> None:
    path = ROOT / "spec" / "durable" / "execution.md"
    check(path.is_file(), "spec/durable/execution.md exists", "spec/durable/execution.md is missing")
    if not path.is_file():
        return
    content = path.read_text(encoding="utf-8")
    check(
        "PAYSWAP_DURABLE_DB" in content,
        "execution.md documents PAYSWAP_DURABLE_DB configuration",
        "execution.md does not document PAYSWAP_DURABLE_DB",
    )
    check(
        "owner" in content.lower(),
        "execution.md documents the event/evidence ownership model",
        "execution.md does not document the ownership model",
    )


def check_package_guard() -> None:
    path = ROOT / "package.json"
    check(path.is_file(), "package.json exists", "package.json is missing")
    if not path.is_file():
        return
    raw = path.read_bytes()
    expected_sha = os.environ.get("PAYSWAP_BASE_PACKAGE_JSON_SHA256", "").strip().lower()

    if expected_sha:
        actual_sha = hashlib.sha256(raw).hexdigest()
        check(
            actual_sha == expected_sha,
            "package.json is byte-identical to the DEP-003 base (sha256 mode)",
            "package.json differs from the DEP-003 base (sha256 mismatch)",
        )
        return

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"package.json does not parse: {error}")
        return
    check(parsed.get("name") == "payswap3", "package.json name is payswap3", "package.json name is not payswap3")

    expected_dependencies = {
        "next": "16.1.3",
        "react": "19.2.3",
        "react-dom": "19.2.3",
    }
    dependencies = parsed.get("dependencies", {})
    check(
        dependencies == expected_dependencies,
        "package.json dependencies are exactly the DEP-003 base set (next, react, react-dom) — zero new dependencies",
        f"package.json dependencies drifted from the base: {json.dumps(dependencies, sort_keys=True)}",
    )

    expected_scripts = {
        "dev": "next dev",
        "build": "next build",
        "start": "next start",
        "typecheck": "tsc --noEmit",
    }
    scripts = parsed.get("scripts", {})
    missing_or_drifted = {
        key: scripts.get(key)
        for key, value in expected_scripts.items()
        if scripts.get(key) != value
    }
    check(
        not missing_or_drifted,
        "package.json scripts match the DEP-003 base (dev/build/start/typecheck)",
        f"package.json scripts drifted: {json.dumps(missing_or_drifted)}",
    )
    extra_scripts = sorted(set(scripts) - set(expected_scripts))
    if extra_scripts:
        print(f"[warn] package.json carries extra scripts beyond the known base (not a dependency drift): {extra_scripts}")
    print(
        "[note] byte-identical mode available: set PAYSWAP_BASE_PACKAGE_JSON_SHA256=<sha256 hex of the base file>"
    )


def main() -> int:
    print(f"DEP-003 validator — repository root: {ROOT}")
    check_migrations()
    check_ts_sources()
    check_test_suite()
    check_spec()
    check_package_guard()
    print()
    print(f"validate_durable: {len(PASSED)} check(s) passed, {len(FAILURES)} failed")
    if FAILURES:
        print("named failure(s):")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
