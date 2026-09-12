#!/usr/bin/env python3
"""
DEP-001 deployment contract validator.

Validates the PaySwap deployment topology and environment contract from the
repository root:

  1. deploy/contracts/components.json parses, and every component carries the
     required fields (id, name, exists_in_repository_today, owner, layer,
     authority_hosted, repository_entrypoint, environment_reachability,
     health_signal, rollback, future_work; production_gate whenever
     'production' is reachable).
  2. Runtime environment contract agrees across registry, documents and
     implementation: the PAYSWAP_ENV allowlist is exactly {sandbox, production}
     with fail-safe 'sandbox' in components.json, spec/deployment/
     environments.md, spec/deployment/configuration.md and src/lib/
     environment.ts.
  3. Every environment in the environments.md matrix appears in components.json
     environment reachability, and the matrix set equals the canonical set.
  4. Every repository entrypoint claimed to exist today exists on disk;
     future-work components carry explicit FUTURE-WORK markers (no silent
     invention); the present-set equals the RTN-012 governed set (all ten
     components, recorded below); every component carries a non-empty
     FUTURE-WORK-tagged future_work note (what remains beyond the in-process
     form: externalized process binding; real-rail credential binding under
     DEP-005).
  5. Runtime ownership model: every component is deployment-owned; protocol
     authority is hosted only by protocol-layer components.
  6. spec/deployment/topology.md agrees with the registry (all component ids
     and the normative execution-topology nodes are present) and records the
     RTN-012 governed contract change.

Usage (from the repository root):

    python3 scripts/validate_deployment.py

Exit codes: 0 = contract valid (summary printed); 1 = validation failure
(errors listed).

Contract evolution is governed: changing the component set, the environment
set or the PAYSWAP_ENV allowlist requires updating components.json, the
spec/deployment/* documents and this validator in the same work item.

Governed change history:
  - DEP-001 generated the contract (base fdef3aa…, present-set locked to
    web-api-boundary).
  - DEP-002 added the runtime-packaging/startup/health delta checks (every
    locked DEP-001 value unchanged).
  - RTN-012 (this form) updated the present-set to all ten components with
    the RTN wave's IN-PROCESS repository entrypoints (rtn-plan-rulings.md
    Q3/delta 3, under the DEP-003 precedent; the topology.md "Contract
    evolution" clause — components.json + spec/deployment/* + this validator
    updated together in the one work item): the declared base moved to the
    RTN wave base (where the in-process entrypoints exist), every component
    carries the future_work note recording the externalized process binding
    (and, for the rail adapters, the DEP-005 real-rail credential binding)
    that remains future work, owner stays 'deployment' for every component,
    authority only in protocol-layer entries, and external-rail-adapters
    stays authority_hosted 'none' (transmission-and-reporting only).

Dependency-free: Python 3 standard library only.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

COMPONENTS_JSON = REPO_ROOT / "deploy" / "contracts" / "components.json"
TOPOLOGY_MD = REPO_ROOT / "spec" / "deployment" / "topology.md"
ENVIRONMENTS_MD = REPO_ROOT / "spec" / "deployment" / "environments.md"
CONFIGURATION_MD = REPO_ROOT / "spec" / "deployment" / "configuration.md"
PACKAGING_MD = REPO_ROOT / "spec" / "deployment" / "packaging.md"
APP_ENVIRONMENT_TS = REPO_ROOT / "src" / "lib" / "environment.ts"
STARTUP_CONFIG_TS = REPO_ROOT / "src" / "lib" / "startup-config.ts"
HEALTH_ROUTE_TS = REPO_ROOT / "src" / "app" / "api" / "health" / "route.ts"
READY_ROUTE_TS = REPO_ROOT / "src" / "app" / "api" / "ready" / "route.ts"
DOCKERFILE = REPO_ROOT / "Dockerfile"
DOCKERIGNORE = REPO_ROOT / ".dockerignore"
NEXT_CONFIG_TS = REPO_ROOT / "next.config.ts"

EXPECTED_BASE_BRANCH = "main"
# The RTN-012 governed contract change moved the declared base to the RTN
# wave base (RTN-001..RTN-011 merged) — the base at which the nine newly
# present components' in-process repository entrypoints exist on disk.
# Precedent: the DEP-001 base fdef3aa79be0d3f5bca7eaad792cef08dc7d7d73.
EXPECTED_BASE_SHA = "14b6ca56c07de585df6d1a3a97edcc36ad2e4c02"
EXPECTED_UPDATED_BY = "RTN-012"
EXPECTED_CONTRACT = "payswap-deployment-components"
# The RTN-012 present-set: web-api-boundary (the application) plus the nine
# protocol/deployment components materialized as in-process module surfaces
# by the RTN wave (rtn-plan-rulings.md Q3/delta 3 — one governed change;
# every claimed entrypoint exists on disk at the declared base).
EXPECTED_PRESENT_COMPONENTS = {
    "web-api-boundary",
    "protocol-gateway",
    "transition-runtime",
    "scheduler",
    "reconciler-workers",
    "netting-settlement-workers",
    "durable-command-queue",
    "authoritative-state-store",
    "evidence-object-store",
    "external-rail-adapters",
}
EXPECTED_ENVIRONMENTS = {"development", "test-ci", "sandbox", "staging", "production"}
EXPECTED_RUNTIME_VAR = "PAYSWAP_ENV"
EXPECTED_RUNTIME_ALLOWLIST = {"sandbox", "production"}
EXPECTED_RUNTIME_FAIL_SAFE = "sandbox"
ALLOWLIST_DOC_STRING = "sandbox | production"
MATRIX_HEADING = "## Environment matrix"
DIAGRAM_ANCHORS = ("Web / API boundary", "Durable command path")

EXPECTED_PRODUCTION_REQUIRED_NAMES = [
    "PAYSWAP_DATABASE_URL",
    "PAYSWAP_QUEUE_URL",
    "PAYSWAP_EVIDENCE_STORE_URL",
    "PAYSWAP_RAIL_ADAPTERS_URL",
]

LAYERS = {"protocol", "product", "deployment"}
ENTRYPOINT_STATUSES = {"present", "future-work"}
REQUIRED_TOP_LEVEL = (
    "contract",
    "version",
    "base_branch",
    "base_sha",
    "runtime_environment_variable",
    "runtime_env_allowlist",
    "runtime_env_fail_safe",
    "environments",
    "spec_documents",
    "field_semantics",
    "components",
)
REQUIRED_COMPONENT_FIELDS = (
    "id",
    "name",
    "exists_in_repository_today",
    "owner",
    "layer",
    "authority_hosted",
    "repository_entrypoint",
    "future_work",
    "environment_reachability",
    "health_signal",
    "rollback",
)

errors = []
checks_performed = 0


def check(condition, message):
    """Record one named contract check; collect failures."""
    global checks_performed
    checks_performed += 1
    if not condition:
        errors.append(message)
    return bool(condition)


def parse_environment_matrix(path):
    """Return environment ids from the '## Environment matrix' table.

    Data rows must place the canonical id in backticks in the first cell
    (e.g. "| `sandbox` | ... |"). Returns None when the section is absent.
    """
    if not path.is_file():
        return None
    lines = path.read_text(encoding="utf-8").splitlines()
    ids = []
    in_matrix = False
    for line in lines:
        if not in_matrix:
            if line.strip().startswith(MATRIX_HEADING):
                in_matrix = True
            continue
        if line.startswith("## "):  # next level-2 heading ends the matrix
            break
        match = re.match(r"^\s*\|\s*`([a-z0-9-]+)`\s*\|", line)
        if match:
            ids.append(match.group(1))
    return ids if in_matrix else None


def main():
    # ---- 1. registry parses -------------------------------------------------
    if not COMPONENTS_JSON.is_file():
        print("DEP-001 deployment contract validation: FAIL")
        print("  missing registry: deploy/contracts/components.json")
        return 1
    try:
        registry = json.loads(COMPONENTS_JSON.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("DEP-001 deployment contract validation: FAIL")
        print(f"  deploy/contracts/components.json does not parse: {exc}")
        return 1
    check(isinstance(registry, dict), "components.json root must be a JSON object")
    if not isinstance(registry, dict):
        print("DEP-001 deployment contract validation: FAIL")
        for message in errors:
            print(f"  - {message}")
        return 1

    # ---- 2. top-level contract fields ---------------------------------------
    for key in REQUIRED_TOP_LEVEL:
        check(key in registry, f"components.json: missing top-level field {key!r}")

    check(
        registry.get("contract") == EXPECTED_CONTRACT,
        f"components.json: contract must be {EXPECTED_CONTRACT!r}",
    )
    check(registry.get("version") == 1, "components.json: version must be 1")
    check(
        registry.get("base_branch") == EXPECTED_BASE_BRANCH,
        f"components.json: base_branch must be {EXPECTED_BASE_BRANCH!r}",
    )
    check(
        registry.get("base_sha") == EXPECTED_BASE_SHA,
        f"components.json: base_sha must be the RTN-012 governed base "
        f"{EXPECTED_BASE_SHA!r} (changing the declared base is a governed "
        "contract change that updates this validator)",
    )
    check(
        registry.get("updated_by") == EXPECTED_UPDATED_BY,
        f"components.json: updated_by must be {EXPECTED_UPDATED_BY!r} (the "
        "work item that last performed the governed contract change; the "
        "provenance field is machine-checked, not silent)",
    )
    check(
        registry.get("runtime_environment_variable") == EXPECTED_RUNTIME_VAR,
        f"components.json: runtime_environment_variable must be {EXPECTED_RUNTIME_VAR!r}",
    )
    allowlist = registry.get("runtime_env_allowlist")
    check(
        isinstance(allowlist, list)
        and len(allowlist) == len(EXPECTED_RUNTIME_ALLOWLIST)
        and set(allowlist) == EXPECTED_RUNTIME_ALLOWLIST,
        "components.json: runtime_env_allowlist must be exactly ['sandbox', 'production'] "
        "(aligned with src/lib/environment.ts; widening is a governed code change)",
    )
    check(
        registry.get("runtime_env_fail_safe") == EXPECTED_RUNTIME_FAIL_SAFE,
        "components.json: runtime_env_fail_safe must be 'sandbox'",
    )
    envs = registry.get("environments")
    check(
        isinstance(envs, list) and len(envs) > 0 and all(isinstance(e, str) for e in envs),
        "components.json: environments must be a non-empty list of strings",
    )
    if isinstance(envs, list):
        check(len(set(envs)) == len(envs), "components.json: duplicate canonical environments")
        check(
            set(envs) == EXPECTED_ENVIRONMENTS,
            f"components.json: environments must be the canonical set "
            f"{sorted(EXPECTED_ENVIRONMENTS)} (found {sorted(set(envs))})",
        )
    spec_docs = registry.get("spec_documents")
    if check(
        isinstance(spec_docs, dict) and len(spec_docs) >= 3,
        "components.json: spec_documents must map topology/environments/configuration",
    ):
        for key in ("topology", "environments", "configuration"):
            doc = spec_docs.get(key)
            if check(
                isinstance(doc, str) and len(doc) > 0,
                f"components.json: spec_documents.{key} must be a non-empty path",
            ):
                check(
                    (REPO_ROOT / doc).is_file(),
                    f"spec document missing on disk: {doc}",
                )
    check(
        isinstance(registry.get("field_semantics"), dict),
        "components.json: field_semantics must be an object (self-describing registry)",
    )

    # ---- 3. components -------------------------------------------------------
    components = registry.get("components")
    check(
        isinstance(components, list) and len(components) > 0,
        "components.json: components must be a non-empty list",
    )
    ids = []
    present_ids = set()
    reach_union = set()
    present_count = 0
    future_count = 0
    if isinstance(components, list):
        for index, component in enumerate(components):
            label = f"component[{index}]"
            if not check(isinstance(component, dict), f"{label} must be an object"):
                continue
            component_id = component.get("id")
            label = f"component {component_id!r}" if isinstance(component_id, str) else label

            for field in REQUIRED_COMPONENT_FIELDS:
                check(field in component, f"{label}: missing required field {field!r}")

            if isinstance(component_id, str):
                if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", component_id):
                    errors.append(f"{label}: id must be kebab-case")
                ids.append(component_id)

            # ownership model
            check(
                component.get("owner") == "deployment",
                f"{label}: owner must be 'deployment' (every deployed component is "
                "deployment-owned per the hard boundaries)",
            )
            layer = component.get("layer")
            check(
                layer in LAYERS,
                f"{label}: layer must be one of 'protocol' | 'product' | 'deployment'",
            )
            authority = component.get("authority_hosted")
            if check(
                isinstance(authority, str) and len(authority.strip()) > 0,
                f"{label}: authority_hosted must be a non-empty string",
            ) and layer in LAYERS:
                lowered = authority.strip().lower()
                if layer == "protocol":
                    check(
                        not lowered.startswith("none"),
                        f"{label}: protocol-layer component must host protocol authority",
                    )
                else:
                    check(
                        lowered.startswith("none"),
                        f"{label}: only protocol-layer components host authority; "
                        "authority_hosted must start with 'none'",
                    )

            # exists-today vs entrypoint status
            exists_today = component.get("exists_in_repository_today")
            check(
                isinstance(exists_today, bool),
                f"{label}: exists_in_repository_today must be a boolean",
            )
            entry = component.get("repository_entrypoint")
            if check(
                isinstance(entry, dict),
                f"{label}: repository_entrypoint must be an object",
            ):
                status = entry.get("status")
                check(
                    status in ENTRYPOINT_STATUSES,
                    f"{label}: repository_entrypoint.status must be 'present' or 'future-work'",
                )
                paths = entry.get("paths")
                if status == "present":
                    check(
                        exists_today is True,
                        f"{label}: present entrypoint requires exists_in_repository_today=true",
                    )
                    if check(
                        isinstance(paths, list) and len(paths) > 0,
                        f"{label}: present entrypoint must list at least one path",
                    ):
                        for rel in paths:
                            if check(
                                isinstance(rel, str) and len(rel.strip()) > 0,
                                f"{label}: entrypoint paths must be non-empty strings",
                            ):
                                if rel.startswith("/") or ".." in Path(rel).parts:
                                    errors.append(
                                        f"{label}: entrypoint path must be a safe "
                                        f"repository-relative path: {rel!r}"
                                    )
                                else:
                                    check(
                                        (REPO_ROOT / rel).exists(),
                                        f"{label}: claimed-today entrypoint missing "
                                        f"on disk: {rel}",
                                    )
                    if isinstance(component_id, str):
                        present_ids.add(component_id)
                        present_count += 1
                elif status == "future-work":
                    check(
                        exists_today is False,
                        f"{label}: future-work entrypoint requires "
                        "exists_in_repository_today=false",
                    )
                    marker = entry.get("marker")
                    check(
                        isinstance(marker, str) and len(marker.strip()) > 0,
                        f"{label}: future-work entrypoint needs a non-empty marker",
                    )
                    check(
                        isinstance(paths, list) and len(paths) == 0,
                        f"{label}: future-work entrypoint must not claim paths",
                    )
                    if isinstance(marker, str):
                        check(
                            "FUTURE-WORK" in marker,
                            f"{label}: future-work marker must carry the FUTURE-WORK tag",
                        )
                    future_count += 1

            # environment reachability
            reach = component.get("environment_reachability")
            if check(
                isinstance(reach, list) and len(reach) > 0,
                f"{label}: environment_reachability must be a non-empty list",
            ):
                for env in reach:
                    if check(
                        isinstance(env, str) and len(env) > 0,
                        f"{label}: reachability entries must be non-empty strings",
                    ) and isinstance(envs, list):
                        check(
                            env in envs,
                            f"{label}: unknown environment {env!r} "
                            "(not in the canonical set)",
                        )
                check(
                    len(set(map(str, reach))) == len(reach),
                    f"{label}: duplicate environment_reachability entries",
                )
                reach_union.update(e for e in reach if isinstance(e, str))
                if "production" in reach:
                    gate = component.get("production_gate")
                    check(
                        isinstance(gate, str) and len(gate.strip()) > 0,
                        f"{label}: production reachability requires a non-empty "
                        "production_gate (fail-closed rule: no production effects "
                        "without separately authorized production configuration)",
                    )

            # descriptive fields
            for field in ("name", "health_signal", "rollback"):
                value = component.get(field)
                check(
                    isinstance(value, str) and len(value.strip()) > 0,
                    f"{label}: {field} must be a non-empty string",
                )

            # the future_work note (rtn-plan-rulings.md Q3/delta 3): what
            # remains beyond the in-process form — externalized process
            # binding; real-rail credential binding under DEP-005. Required
            # for EVERY component (present and future-work alike) and
            # carrying the FUTURE-WORK tag.
            future = component.get("future_work")
            if check(
                isinstance(future, str) and len(future.strip()) > 0,
                f"{label}: future_work must be a non-empty string (the future "
                "work that remains beyond the in-process form — Q3/delta 3)",
            ) and isinstance(future, str):
                check(
                    "FUTURE-WORK" in future,
                    f"{label}: future_work must carry the FUTURE-WORK tag "
                    "(recorded future work, never a silent present-claim)",
                )

            # optional route surface
            surface = component.get("route_surface")
            if surface is not None:
                if check(
                    isinstance(surface, list), f"{label}: route_surface must be a list"
                ):
                    for route in surface:
                        check(
                            isinstance(route, str)
                            and re.fullmatch(r"/[A-Za-z0-9._/-]*", route),
                            f"{label}: invalid route_surface entry {route!r}",
                        )

    check(
        len(set(ids)) == len(ids),
        f"duplicate component ids: {[i for i in ids if ids.count(i) > 1]}",
    )

    # ---- 4. honesty lock: the RTN-012 governed present-set -----------------
    check(
        present_ids == EXPECTED_PRESENT_COMPONENTS,
        f"components claiming repository presence today must equal the "
        f"RTN-012 governed set {sorted(EXPECTED_PRESENT_COMPONENTS)} (found "
        f"{sorted(present_ids)}); changing the present-set is a governed "
        "contract change that updates this validator together with "
        "components.json and the spec/deployment/* documents",
    )

    # ---- 5. environments.md matrix agreement ---------------------------------
    md_envs = parse_environment_matrix(ENVIRONMENTS_MD)
    if check(
        isinstance(md_envs, list) and len(md_envs) > 0,
        "spec/deployment/environments.md: no '## Environment matrix' table with "
        "backticked ids found",
    ):
        if isinstance(envs, list):
            check(
                set(md_envs) == set(envs),
                f"environments.md matrix ids {sorted(set(md_envs))} must equal the "
                f"canonical set {sorted(set(envs))}",
            )
            missing = sorted(set(md_envs) - reach_union)
            check(
                len(missing) == 0,
                f"environments.md environments absent from components.json "
                f"environment reachability: {missing}",
            )

    # ---- 6. allowlist agreement: documents + implementation ------------------
    for doc in (ENVIRONMENTS_MD, CONFIGURATION_MD):
        rel = str(doc.relative_to(REPO_ROOT))
        if check(doc.is_file(), f"missing spec document: {rel}"):
            text = doc.read_text(encoding="utf-8")
            check(
                ALLOWLIST_DOC_STRING in text,
                f"{rel} must state the exact runtime allowlist 'sandbox | production'",
            )
    if check(
        CONFIGURATION_MD.is_file(),
        "missing spec document: spec/deployment/configuration.md",
    ):
        config_text = CONFIGURATION_MD.read_text(encoding="utf-8")
        check(
            "PAYSWAP_ENV" in config_text,
            "spec/deployment/configuration.md must document PAYSWAP_ENV",
        )
    if check(
        APP_ENVIRONMENT_TS.is_file(),
        "src/lib/environment.ts (the application environment contract) is missing "
        "on disk",
    ):
        ts_text = APP_ENVIRONMENT_TS.read_text(encoding="utf-8")
        check(
            "sandbox" in ts_text and "production" in ts_text,
            "src/lib/environment.ts must implement the sandbox/production allowlist",
        )

    # ---- 7. topology.md agreement ---------------------------------------------
    if check(
        TOPOLOGY_MD.is_file(),
        "missing spec document: spec/deployment/topology.md",
    ):
        topology_text = TOPOLOGY_MD.read_text(encoding="utf-8")
        for component_id in ids:
            check(
                component_id in topology_text,
                f"topology.md must document component {component_id!r}",
            )
        for anchor in DIAGRAM_ANCHORS:
            check(
                anchor in topology_text,
                f"topology.md must quote the execution topology node {anchor!r}",
            )
        check(
            "FUTURE-WORK" in topology_text,
            "topology.md must carry FUTURE-WORK markers for the future work "
            "that remains beyond the in-process forms",
        )
        # The RTN-012 governed contract change is recorded in the document
        # itself (the as-of-today overlay + the contract-evolution record).
        check(
            "RTN-012" in topology_text,
            "topology.md must record the RTN-012 governed contract change "
            "(the as-of-today overlay update + the contract-evolution note)",
        )
        check(
            "in-process" in topology_text,
            "topology.md must state the in-process materialization form of "
            "the RTN wave's components (rtn-plan-rulings.md Q3)",
        )

    # ---- 7. DEP-002 runtime packaging, startup validation, health/ready ----
    # (delta checks added by the DEP-002 governed contract change; every
    #  locked DEP-001 value above is unchanged)
    def read(p):
        return p.read_text(encoding="utf-8") if p.is_file() else ""

    # 7a. standalone packaging configuration (directive-aware: the literal
    # directive line, not a comment mention)
    nc = read(NEXT_CONFIG_TS)
    check(NEXT_CONFIG_TS.is_file(), "next.config.ts must exist")
    check(
        re.search(r'^\s*output:\s*"standalone",?\s*$', nc, re.MULTILINE) is not None,
        'next.config.ts must set output: "standalone" (reproducible runtime package)',
    )

    # 7b. Dockerfile: multi-stage, deterministic, non-root, runtime-only env
    dk = read(DOCKERFILE)
    check(DOCKERFILE.is_file(), "Dockerfile must exist")
    if dk:
        from_lines = [ln for ln in dk.splitlines() if ln.strip().upper().startswith("FROM ")]
        check(
            len(from_lines) >= 2,
            "Dockerfile must be multi-stage (at least 2 FROM directives)",
        )
        check(
            any("node:22-alpine" in ln for ln in from_lines),
            "Dockerfile must pin a node:22-alpine base image",
        )
        check(
            any(ln.strip().upper().startswith("USER ") for ln in dk.splitlines()),
            "Dockerfile must run as a non-root user (USER directive)",
        )
        # directive-aware F2 check: no ENV/ARG directive may set
        # PAYSWAP_ENV=production (comments mentioning it are fine)
        bad_env = [
            ln
            for ln in dk.splitlines()
            if re.match(r"^\s*(ENV|ARG)\s+PAYSWAP_ENV=production", ln, re.IGNORECASE)
        ]
        check(
            not bad_env,
            "Dockerfile must never set PAYSWAP_ENV=production as a build-time "
            "default (F2: production is runtime-injected only)",
        )
        check(
            "npm ci" in dk and "npm run build" in dk,
            "Dockerfile must install from the lockfile (npm ci) and run the "
            "repository build (npm run build)",
        )

    # 7c. .dockerignore keeps secrets and host state out of the image
    di = read(DOCKERIGNORE)
    check(DOCKERIGNORE.is_file(), ".dockerignore must exist")
    if di:
        for pattern in (".env", "node_modules", ".next", ".git"):
            check(
                pattern in di,
                f".dockerignore must exclude {pattern!r} (S1-S5 secret boundary / "
                "reproducible build context)",
            )

    # 7d. startup configuration validation module
    sc = read(STARTUP_CONFIG_TS)
    check(STARTUP_CONFIG_TS.is_file(), "src/lib/startup-config.ts must exist")
    if sc:
        check(
            "getEnvironment" in sc and "@/lib/environment" in sc,
            "startup-config.ts must resolve the environment through the frozen "
            "src/lib/environment.ts module (getEnvironment import)",
        )
        check(
            "resolveRuntimeEnvironment" not in sc
            and "process.env.PAYSWAP_ENV" not in sc,
            "startup-config.ts must not re-implement the environment allowlist (F1)",
        )
        for name in EXPECTED_PRODUCTION_REQUIRED_NAMES:
            check(
                f'"{name}"' in sc,
                f"startup-config.ts must declare the production required name {name} "
                "(as a quoted array entry)",
            )

    # 7e. liveness and readiness endpoints
    hr = read(HEALTH_ROUTE_TS)
    check(HEALTH_ROUTE_TS.is_file(), "src/app/api/health/route.ts must exist")
    if hr:
        check(
            "getEnvironment" in hr and "force-dynamic" in hr,
            "/api/health must report the environment via the frozen module and be "
            "dynamic (never baked at build time)",
        )
    rr = read(READY_ROUTE_TS)
    check(READY_ROUTE_TS.is_file(), "src/app/api/ready/route.ts must exist")
    if rr:
        check(
            "validateStartupConfig" in rr and "force-dynamic" in rr,
            "/api/ready must run startup-config validation and be dynamic",
        )
        check(
            "503" in rr,
            "/api/ready must fail closed with 503 when required configuration "
            "is missing (F6)",
        )

    # 7f. components.json records the real packaging + health signal
    web = next((c for c in registry.get("components", [])
                if c.get("id") == "web-api-boundary"), {})
    entry = web.get("repository_entrypoint") or {}
    entry_paths = entry.get("paths", []) if isinstance(entry, dict) else []
    for path in ("Dockerfile", "next.config.ts", "src/lib/startup-config.ts",
                 "src/app/api/health/route.ts", "src/app/api/ready/route.ts"):
        check(
            path in entry_paths,
            f"components.json web-api-boundary entrypoints must include {path}",
        )
    hs = str(web.get("health_signal", ""))
    check(
        "/api/health" in hs and "/api/ready" in hs,
        "components.json web-api-boundary health_signal must name /api/health "
        "and /api/ready",
    )
    rc = web.get("required_configuration") or {}
    prod_names = rc.get("production", []) if isinstance(rc, dict) else []
    check(
        sorted(prod_names) == sorted(EXPECTED_PRODUCTION_REQUIRED_NAMES),
        "components.json web-api-boundary required_configuration.production must "
        f"equal {sorted(EXPECTED_PRODUCTION_REQUIRED_NAMES)}",
    )
    pk = read(PACKAGING_MD)
    check(PACKAGING_MD.is_file(), "spec/deployment/packaging.md must exist")
    if pk:
        check(
            "/api/health" in pk and "/api/ready" in pk,
            "packaging.md must document the health/readiness endpoints",
        )
        check(
            "F2" in pk and "F6" in pk,
            "packaging.md must reference the fail-closed rules F2/F6",
        )
        check(
            "standalone" in pk,
            "packaging.md must document the standalone runtime package",
        )

    # 7g. secret-boundary scan across the deployment surfaces (S1-S5)
    import subprocess as _sp
    tracked_env = _sp.run(
        ["git", "ls-files", ".env"], cwd=str(REPO_ROOT),
        capture_output=True, text=True,
    ).stdout.strip()
    check(
        not tracked_env,
        ".env must not be git-tracked (S1: no secret material is source-controlled)",
    )
    _secret_patterns = (
        r"ghp_[A-Za-z0-9]{20,}",
        r"gho_[A-Za-z0-9]{20,}",
        r"sk-[A-Za-z0-9]{20,}",
        r"AKIA[0-9A-Z]{16}",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    )
    for surface in (DOCKERFILE, DOCKERIGNORE, NEXT_CONFIG_TS, PACKAGING_MD,
                    STARTUP_CONFIG_TS, HEALTH_ROUTE_TS, READY_ROUTE_TS):
        text_s = read(surface)
        for pat in _secret_patterns:
            check(
                not re.search(pat, text_s),
                f"secret-value pattern {pat!r} found in "
                f"{surface.relative_to(REPO_ROOT)} (S1 violation)",
            )

    # ---- summary ---------------------------------------------------------------
    total = present_count + future_count
    print("DEP-001/DEP-002/RTN-012 deployment contract validation")
    print(f"  base: {registry.get('base_branch')} @ {registry.get('base_sha')}")
    print(f"  last governed change: {registry.get('updated_by')}")
    print(
        f"  components: {total} total, {present_count} present today "
        f"(in-process module surfaces), {future_count} future-work"
    )
    if isinstance(envs, list):
        print(f"  environments: {', '.join(envs)}")
    print(
        f"  runtime allowlist: {EXPECTED_RUNTIME_VAR} in "
        f"{sorted(EXPECTED_RUNTIME_ALLOWLIST)} (fail-safe: {EXPECTED_RUNTIME_FAIL_SAFE})"
    )
    print(f"  checks performed: {checks_performed}")
    if errors:
        print(f"  result: FAIL ({len(errors)} error(s))")
        for message in errors:
            print(f"    - {message}")
        return 1
    print("  result: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
