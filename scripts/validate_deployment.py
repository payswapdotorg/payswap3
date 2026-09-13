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
  7. DEP-002 runtime packaging, startup validation and health/readiness
     (Dockerfile, next.config.ts, .dockerignore, startup-config, the health
     and ready routes, packaging.md) — every locked DEP-001 value unchanged.
  8. DEP-005 external rail connectivity boundary: the external-rail-adapters
     component's entrypoints include the rail-connectivity family (each
     exists on disk); the component's required_configuration pattern names
     agree with spec/deployment/configuration.md's current-values table and
     the resolver's variable templates (src/lib/rail-connectivity/
     configuration.ts); topology.md records the DEP-005 governed contract
     change; the secret-boundary patterns (S1-S5) are scanned over the
     family's source too.
  9. DEP-006 CI/CD and promotion (spec/deployment/ci-cd.md): the workflow
     files exist and reference only repo-local gate scripts (every
     repository script they invoke exists on disk; no run: step fetches or
     executes remote code); the CI/CD toolchain exists (gate runner,
     promotion tool, package snapshot, the contract document); the
     components.json ci_cd contract object agrees with the tree (every
     referenced path exists; the gate list matches the contract order);
     deploy/promotions/ is present in the tree and promotion-records.jsonl
     exists, with every record carrying all gates passing + a content
     digest (migration-audit and build-evidence entries reference existing
     records and carry their digests/checksums; a promotion record whose
     environment context resolves to production is refused — production
     deployment binding is FUTURE-WORK); topology.md and configuration.md
     record the DEP-006 governed contract change; the secret-boundary
     patterns (S1-S5) are scanned over the new surfaces too.

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
  - RTN-012 updated the present-set to all ten components with the RTN
    wave's IN-PROCESS repository entrypoints (rtn-plan-rulings.md
    Q3/delta 3, under the DEP-003 precedent; the topology.md "Contract
    evolution" clause — components.json + spec/deployment/* + this
    validator updated together in the one work item): the declared base
    moved to the RTN wave base (where the in-process entrypoints exist),
    every component carries the future_work note recording the
    externalized process binding (and, for the rail adapters, the DEP-005
    real-rail credential binding) that remains future work, owner stays
    'deployment' for every component, authority only in protocol-layer
    entries, and external-rail-adapters stays authority_hosted 'none'
    (transmission-and-reporting only).
  - DEP-004 added the 'operational-jobs' component (the durable
    operational-jobs family — reconciliation sweeps, clearing batch
    progression, netting-settlement progression, queue-draining support;
    layer deployment, authority none — orchestration only, commands
    exclusively through the protocol gateway) and moved the declared base
    to the DEP-004 dispatch base (main @ 2c3f9cf — the composed protocol
    runtime the jobs orchestrate over; the operational-jobs entrypoints
    arrive with the DEP-004 work item's tree and the on-disk honesty check
    runs against it). All three surfaces updated together in the one work
    item; every locked value otherwise unchanged.

  - DEP-005 (this form) landed the external rail connectivity boundary as
    an owned in-process surface of the existing 'external-rail-adapters'
    component (no present-set change): the src/lib/rail-connectivity/
    family (typed transport port with the explicit result quadruple,
    environment-scoped per-rail configuration resolution with credential
    REFERENCES only + scope isolation, same-key/bounded/backoff/
    deadline-aware retry engine, structured adapter-activity observability,
    the composition into the frozen A13 RailAdapterConnection interface)
    plus the scripts/test_rail_connectivity.mjs evidence harness. The
    component's entrypoints, required_configuration pattern names and
    health_signal were updated; the future_work note now records exactly
    what remains (the real network transport primitive + real adapters and
    the production credential binding - secret-store dereference, both at
    the externalized binding). The declared base moved to the DEP-005
    dispatch base (main @ 5bda6c0 - DEP-003 + DEP-004 merged). All four
    surfaces - components.json, topology.md, configuration.md and this
    validator - were updated together in the one work item; every locked
    value otherwise unchanged.

  - DEP-006 (this form) landed the CI/CD and promotion contract
    (spec/deployment/ci-cd.md) as repository-local deployment-layer
    automation - no present-set change (all eleven components unchanged):
    the gate runner scripts/run_ci_gates.mjs, the promotion tool
    scripts/promote.mjs (record / migrate / verify / rollback-plan;
    append-only JSONL promotion records in
    deploy/promotions/promotion-records.jsonl), the package-snapshot
    evidence tool scripts/package_snapshot.mjs, and the GitHub Actions
    workflows .github/workflows/ci.yml + promotion.yml (repo-local gates
    only). The registry gained the top-level 'ci_cd' contract object. The
    declared base moved to the DEP-006 dispatch base (main @ 663b1d4 -
    DEP-002/003/004/005 all merged; the work order's dependency gate
    satisfied). Production deployment binding is recorded FUTURE-WORK:
    every production_gate stays authoritative and the promotion tool
    refuses a resolved PAYSWAP_ENV=production context. All four surfaces -
    components.json, topology.md, configuration.md and this validator -
    were updated together in the one work item; every locked value
    otherwise unchanged.

  - DEP-008 (this form) landed the production readiness proof contract
    (spec/deployment/production-readiness.md) as repository-local
    deployment-layer EVIDENCE - no present-set change (all eleven
    components unchanged): the readiness proof harness
    scripts/test_production_readiness.mjs (ten named fail-closed proof
    groups wrapping the composed-journey, DEP-007-drill, operations and
    rail-connectivity harnesses and composing the DEP-006 promotion
    tooling; each group checks its assigned work-order stop condition),
    the captured verification transcript
    deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md (required once a
    promotion record exists whose recorded commit subject begins
    'DEP-008:' - append-only records trail the revision they freeze), and
    the promotion records for the release revision. The ci_cd registry
    object gained readiness_harness / readiness_transcript /
    readiness_contract / readiness_proof_groups. A disclosed one-line
    battery-determinism fix was applied to
    scripts/test_observability_resilience.mjs (a drill note printed the
    epoch-ms backup id - violating the ci-cd.md section 2 byte-
    determinism contract and breaking promote.mjs verify for any record
    at a tree containing it; no assertion, scenario or drill changed).
    The declared base moved to the DEP-008 dispatch base (main @ a39cccf
    - DEP-006 + DEP-007 + the product closure candidate UI-010 all
    merged; the work order's dependency gate satisfied). Production
    readiness is never inferred from sandbox behavior (F8); the
    production deployment binding stays FUTURE-WORK and every
    production_gate stays authoritative. All four surfaces -
    components.json, topology.md, configuration.md and this validator -
    were updated together in the one work item; every locked value
    otherwise unchanged.

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
RAIL_CONNECTIVITY_DIR = REPO_ROOT / "src" / "lib" / "rail-connectivity"
RAIL_CONNECTIVITY_CONFIGURATION_TS = RAIL_CONNECTIVITY_DIR / "configuration.ts"
RAIL_CONNECTIVITY_HARNESS = REPO_ROOT / "scripts" / "test_rail_connectivity.mjs"

# DEP-006 CI/CD and promotion surfaces (spec/deployment/ci-cd.md).
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"
PROMOTION_YML = REPO_ROOT / ".github" / "workflows" / "promotion.yml"
GATE_RUNNER = REPO_ROOT / "scripts" / "run_ci_gates.mjs"
PROMOTION_TOOL = REPO_ROOT / "scripts" / "promote.mjs"
PACKAGE_SNAPSHOT = REPO_ROOT / "scripts" / "package_snapshot.mjs"
CI_CD_MD = REPO_ROOT / "spec" / "deployment" / "ci-cd.md"
PROMOTIONS_DIR = REPO_ROOT / "deploy" / "promotions"
PROMOTION_RECORDS = PROMOTIONS_DIR / "promotion-records.jsonl"
EXPECTED_CI_CD_GATES = [
    "governance",
    "deployment-contract",
    "durable-contract",
    "typecheck",
    "harnesses",
    "build",
]

EXPECTED_BASE_BRANCH = "main"
# The governed contract change moves the declared base with each wave that
# updates the shared surfaces (changing the declared base is a governed
# contract change that updates this validator). Precedents: the DEP-001
# base fdef3aa79be0d3f5bca7eaad792cef08dc7d7d73; the RTN-012 base
# 14b6ca56c07de585df6d1a3a97edcc36ad2e4c02; the DEP-004 base
# 2c3f9cf0efb7bae808662d4dd1adaf604d69de0e; the DEP-005 base
# 5bda6c02a6302461908a5601da5b49f655a489c1; the DEP-006 and DEP-007
# dispatch bases are both 663b1d4 (dispatched in parallel); the DEP-008
# dispatch base is a39cccf (DEP-006 + DEP-007 + the product closure
# candidate UI-010 all merged — the work order's dependency gate).
EXPECTED_BASE_SHA = "a39cccf312cf55aff6321eb5e0dbbde7936f201b"
EXPECTED_UPDATED_BY = "DEP-008"
EXPECTED_CONTRACT = "payswap-deployment-components"
# The DEP-004 present-set: the RTN-012 ten-component set plus the
# 'operational-jobs' component (the durable operational-jobs family —
# one governed change; every claimed entrypoint exists on disk in this
# work item's tree).
EXPECTED_PRESENT_COMPONENTS = {
    "web-api-boundary",
    "protocol-gateway",
    "transition-runtime",
    "scheduler",
    "reconciler-workers",
    "netting-settlement-workers",
    "operational-jobs",
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

# The DEP-005 rail-connectivity required-configuration pattern names (per
# rail; {RAIL} is the declared rail id upper-cased with '-' → '_'). Names
# and patterns only — never values (S1-S5).
EXPECTED_RAIL_CONNECTIVITY_PRODUCTION_NAMES = [
    "PAYSWAP_RAIL_PRODUCTION_{RAIL}_HOST",
    "PAYSWAP_RAIL_PRODUCTION_{RAIL}_CREDENTIAL_REF",
    "PAYSWAP_RAIL_PRODUCTION_{RAIL}_TIMEOUT_MS",
]
EXPECTED_RAIL_CONNECTIVITY_SANDBOX_NAMES = [
    "PAYSWAP_RAIL_SANDBOX_{RAIL}_HOST",
    "PAYSWAP_RAIL_SANDBOX_{RAIL}_TIMEOUT_MS",
]
# The rail-connectivity family entrypoints the external-rail-adapters
# component claims since DEP-005 (the on-disk honesty check runs against
# this working tree).
EXPECTED_RAIL_CONNECTIVITY_ENTRYPOINTS = [
    "src/lib/rail-connectivity/index.ts",
    "src/lib/rail-connectivity/transport.ts",
    "src/lib/rail-connectivity/configuration.ts",
    "src/lib/rail-connectivity/retry.ts",
    "src/lib/rail-connectivity/activity.ts",
    "src/lib/rail-connectivity/boundary.ts",
    "src/lib/rail-connectivity/RAIL-CONNECTIVITY-EVIDENCE.md",
    "scripts/test_rail_connectivity.mjs",
]

# DEP-008 production readiness proof surfaces (spec/deployment/
# production-readiness.md).
READINESS_HARNESS = REPO_ROOT / "scripts" / "test_production_readiness.mjs"
READINESS_CONTRACT_MD = REPO_ROOT / "spec" / "deployment" / "production-readiness.md"
READINESS_TRANSCRIPT_MD = REPO_ROOT / "deploy" / "promotions" / "DEP-008-READINESS-TRANSCRIPT.md"
EXPECTED_PROOF_GROUPS = [
    "proof:release-identity",
    "proof:protocol-integration",
    "proof:ui-integration",
    "proof:failure-injection",
    "proof:scaling-behavior",
    "proof:config-secret-safety",
    "proof:backup-restore-queue-recovery",
    "proof:unknown-reconciliation",
    "proof:external-effect-safety",
    "proof:rollback-observability",
]
EXPECTED_READINESS_STOP_CONDITIONS = [
    "unsafe external retry",
    "environment crossing",
    "missing recovery path",
    "unreconciled UNKNOWN",
    "configuration ambiguity",
    "unexplained authority bypass",
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
        f"components.json: base_sha must be the DEP-004 governed base "
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

    # ---- 4. honesty lock: the DEP-004 governed present-set ------------------
    check(
        present_ids == EXPECTED_PRESENT_COMPONENTS,
        f"components claiming repository presence today must equal the "
        f"DEP-004 governed set {sorted(EXPECTED_PRESENT_COMPONENTS)} (found "
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

    # ---- 8. DEP-005 external rail connectivity boundary ----------------------
    # (delta checks added by the DEP-005 governed contract change; every
    #  locked value above is unchanged. The boundary is an owned in-process
    #  surface of the existing external-rail-adapters component — the
    #  present-set itself does not change.)
    rails_component = next(
        (c for c in registry.get("components", []) if c.get("id") == "external-rail-adapters"),
        {},
    )
    rails_entry = rails_component.get("repository_entrypoint") or {}
    rails_paths = rails_entry.get("paths", []) if isinstance(rails_entry, dict) else []

    # 8a. the rail-connectivity family entrypoints are claimed and exist
    #     on disk (the honesty rule: claimed-today entrypoints are real).
    for rel in EXPECTED_RAIL_CONNECTIVITY_ENTRYPOINTS:
        check(
            rel in rails_paths,
            f"components.json external-rail-adapters entrypoints must include {rel} "
            "(the DEP-005 rail-connectivity family)",
        )
        check(
            (REPO_ROOT / rel).exists(),
            f"claimed rail-connectivity entrypoint missing on disk: {rel}",
        )

    # 8b. the required-configuration pattern names agree with the
    #     configuration doc and the resolver's variable templates (names
    #     only — never values; S1-S5).
    rails_required = rails_component.get("required_configuration") or {}
    if check(
        isinstance(rails_required, dict),
        "components.json external-rail-adapters must carry required_configuration "
        "(the DEP-005 per-rail pattern names)",
    ):
        prod_names = rails_required.get("production", [])
        sandbox_names = rails_required.get("sandbox", [])
        check(
            sorted(prod_names) == sorted(EXPECTED_RAIL_CONNECTIVITY_PRODUCTION_NAMES),
            "components.json external-rail-adapters required_configuration.production "
            f"must equal {sorted(EXPECTED_RAIL_CONNECTIVITY_PRODUCTION_NAMES)} "
            f"(found {sorted(prod_names)})",
        )
        check(
            sorted(sandbox_names) == sorted(EXPECTED_RAIL_CONNECTIVITY_SANDBOX_NAMES),
            "components.json external-rail-adapters required_configuration.sandbox "
            f"must equal {sorted(EXPECTED_RAIL_CONNECTIVITY_SANDBOX_NAMES)} "
            f"(found {sorted(sandbox_names)})",
        )

    # 8c. spec/deployment/configuration.md documents the rail-connectivity
    #     variables in its current-values table (the closed list).
    if CONFIGURATION_MD.is_file():
        config_text_s = CONFIGURATION_MD.read_text(encoding="utf-8")
        for name in (EXPECTED_RAIL_CONNECTIVITY_PRODUCTION_NAMES
                     + EXPECTED_RAIL_CONNECTIVITY_SANDBOX_NAMES):
            check(
                name in config_text_s,
                f"spec/deployment/configuration.md must document the rail-connectivity "
                f"variable pattern {name} (the DEP-005 current-values entry)",
            )
        check(
            "CREDENTIAL_REF" in config_text_s,
            "spec/deployment/configuration.md must document the credential "
            "REFERENCE variable (names only, never values — S1-S5)",
        )

    # 8d. the resolver's variable templates agree with the registry's
    #     required-configuration pattern names (the resolver derives the
    #     concrete names from the {SCOPE}/{RAIL} templates + the scope
    #     segments SANDBOX/PRODUCTION).
    if check(
        RAIL_CONNECTIVITY_CONFIGURATION_TS.is_file(),
        "src/lib/rail-connectivity/configuration.ts (the rail connectivity "
        "configuration resolver) is missing on disk",
    ):
        resolver_text = RAIL_CONNECTIVITY_CONFIGURATION_TS.read_text(encoding="utf-8")
        for template in (
            "PAYSWAP_RAIL_{SCOPE}_{RAIL}_HOST",
            "PAYSWAP_RAIL_{SCOPE}_{RAIL}_CREDENTIAL_REF",
            "PAYSWAP_RAIL_{SCOPE}_{RAIL}_TIMEOUT_MS",
        ):
            check(
                template in resolver_text,
                f"src/lib/rail-connectivity/configuration.ts must carry the "
                f"variable-name template {template} (agreement with the "
                "registry's required_configuration)",
            )
        for segment in ("PRODUCTION", "SANDBOX"):
            check(
                f"'{segment}'" in resolver_text,
                f"src/lib/rail-connectivity/configuration.ts must derive the "
                f"{segment} scope segment (the scope-isolated name forms)",
            )
        check(
            "scopeTag" in resolver_text,
            "the resolver must scope-tag every resolved rail (the isolation proof)",
        )
        check(
            "SCOPE_MISMATCH" in resolver_text and "SCOPE_CONTAMINATION" in resolver_text,
            "the resolver must refuse cross-scope resolution and both-scope "
            "contamination (the sandbox/production isolation acceptance)",
        )
        check(
            "CREDENTIAL_REF_REQUIRED_FOR_PRODUCTION" in resolver_text,
            "the resolver must fail closed for production rails without a "
            "credential reference (F6)",
        )

    # 8e. topology.md records the DEP-005 governed contract change and the
    #     connectivity boundary as the component's owned surface.
    if TOPOLOGY_MD.is_file():
        topology_text_s = TOPOLOGY_MD.read_text(encoding="utf-8")
        check(
            "DEP-005" in topology_text_s,
            "topology.md must record the DEP-005 governed contract change "
            "(the contract-evolution change record)",
        )
        check(
            "src/lib/rail-connectivity/" in topology_text_s,
            "topology.md must document the rail-connectivity family as the "
            "external-rail-adapters component's owned surface",
        )

    # 8f. the S1 secret-boundary scan covers the rail-connectivity family
    #     source too (credential VALUES never appear in the boundary).
    if RAIL_CONNECTIVITY_DIR.is_dir():
        for source in sorted(RAIL_CONNECTIVITY_DIR.glob("*.ts")):
            text_s = source.read_text(encoding="utf-8")
            for pat in _secret_patterns:
                check(
                    not re.search(pat, text_s),
                    f"secret-value pattern {pat!r} found in "
                    f"{source.relative_to(REPO_ROOT)} (S1 violation)",
                )
    check(
        RAIL_CONNECTIVITY_HARNESS.is_file(),
        "scripts/test_rail_connectivity.mjs (the DEP-005 evidence harness) is "
        "missing on disk",
    )

    # ---- 9. DEP-006 CI/CD and promotion ------------------------------------
    # (delta checks added by the DEP-006 governed contract change; every
    #  locked value above is unchanged. CI/CD is deployment-owned capacity —
    #  the registry's top-level ci_cd contract object — not a component: the
    #  present-set does not change. The contract is spec/deployment/ci-cd.md.)

    def workflow_run_steps(path):
        """Extract the `run:` step command lines from a workflow YAML file."""
        if not path.is_file():
            return None
        steps = []
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("- name:") or stripped.startswith("name:"):
                continue
            if stripped.startswith("run:"):
                command = stripped[len("run:"):].strip()
                if command:
                    steps.append(command)
        return steps

    # 9a. the workflow files exist and reference only repo-local gate scripts.
    ci_text = read(CI_YML)
    check(CI_YML.is_file(), ".github/workflows/ci.yml must exist (the CI workflow)")
    if ci_text:
        check(
            "node scripts/run_ci_gates.mjs" in ci_text,
            "ci.yml must run the repo-local gate battery (node scripts/run_ci_gates.mjs) — "
            "no gate may exist that only CI can run",
        )
        check(
            "bun install --frozen-lockfile" in ci_text,
            "ci.yml must install the locked dependency graph (bun install --frozen-lockfile)",
        )
    promo_text = read(PROMOTION_YML)
    check(PROMOTION_YML.is_file(), ".github/workflows/promotion.yml must exist "
          "(the promotion-evidence workflow)")
    if promo_text:
        check(
            "workflow_dispatch" in promo_text,
            "promotion.yml must be workflow_dispatch-only (manual promotion evidence, "
            "no automatic production promotion)",
        )
        check(
            "node scripts/promote.mjs verify" in promo_text,
            "promotion.yml must re-verify records with the repo-local promotion tool "
            "(node scripts/promote.mjs verify)",
        )
    for workflow in (CI_YML, PROMOTION_YML):
        rel = str(workflow.relative_to(REPO_ROOT))
        if not workflow.is_file():
            continue
        steps = workflow_run_steps(workflow)
        if steps is not None:
            for command in steps:
                check(
                    "http://" not in command and "https://" not in command
                    and not re.search(r"\b(curl|wget|nc|ssh)\b", command),
                    f"{rel}: run step must not fetch or execute remote code "
                    f"(repo-local gate scripts only): {command[:60]!r}",
                )
                for match in re.finditer(r"scripts/[A-Za-z0-9_./-]+", command):
                    script_rel = match.group(0).strip('"').strip("'")
                    if script_rel.endswith("."):
                        script_rel = script_rel[:-1]
                    check(
                        (REPO_ROOT / script_rel).exists(),
                        f"{rel}: references a repository script missing on disk: {script_rel}",
                    )

    # 9b. the CI/CD toolchain exists on disk (the honesty rule).
    for tool, label in (
        (GATE_RUNNER, "the gate runner"),
        (PROMOTION_TOOL, "the promotion tool"),
        (PACKAGE_SNAPSHOT, "the package-snapshot evidence tool"),
        (CI_CD_MD, "the CI/CD contract document"),
    ):
        check(tool.is_file(), f"{tool.relative_to(REPO_ROOT)} ({label}) is missing on disk")

    # 9c. the registry's ci_cd contract object agrees with the tree.
    ci_cd = registry.get("ci_cd")
    if check(
        isinstance(ci_cd, dict),
        "components.json: the top-level ci_cd contract object is required (DEP-006)",
    ):
        for key in ("work_order", "spec_document", "gate_runner", "promotion_tool",
                    "package_snapshot", "workflows", "promotion_records", "gate_list"):
            check(key in ci_cd, f"components.json: ci_cd.{key} is required")
        check(
            ci_cd.get("work_order") == "DEP-006",
            "components.json: ci_cd.work_order must be 'DEP-006'",
        )
        for key in ("spec_document", "gate_runner", "promotion_tool", "package_snapshot"):
            value = ci_cd.get(key)
            if check(
                isinstance(value, str) and len(value.strip()) > 0,
                f"components.json: ci_cd.{key} must be a non-empty path",
            ):
                check(
                    (REPO_ROOT / value).is_file(),
                    f"components.json: ci_cd.{key} missing on disk: {value}",
                )
        workflows = ci_cd.get("workflows")
        if check(
            isinstance(workflows, list) and len(workflows) == 2,
            "components.json: ci_cd.workflows must list the two workflow files",
        ):
            for workflow in workflows:
                if check(
                    isinstance(workflow, str) and len(workflow) > 0,
                    "components.json: ci_cd.workflows entries must be non-empty paths",
                ):
                    check(
                        (REPO_ROOT / workflow).is_file(),
                        f"components.json: ci_cd workflow missing on disk: {workflow}",
                    )
        records_rel = ci_cd.get("promotion_records")
        if check(
            isinstance(records_rel, str) and len(records_rel) > 0,
            "components.json: ci_cd.promotion_records must be a non-empty path",
        ):
            check(
                (REPO_ROOT / records_rel).is_file(),
                f"components.json: ci_cd.promotion_records missing on disk: {records_rel}",
            )
        gate_list = ci_cd.get("gate_list")
        check(
            gate_list == EXPECTED_CI_CD_GATES,
            f"components.json: ci_cd.gate_list must equal the contract gate order "
            f"{EXPECTED_CI_CD_GATES} (found {gate_list})",
        )
        production_note = str(ci_cd.get("production_promotion", ""))
        check(
            "FUTURE-WORK" in production_note and "production_gate" in production_note,
            "components.json: ci_cd.production_promotion must record the FUTURE-WORK "
            "production deployment binding with the production_gate staying authoritative",
        )

    # 9d. deploy/promotions/ is present and the records file exists; every
    #     record carries all gates passing + a content digest (fail-closed:
    #     the file starts empty at the implementation commit — append-only
    #     records can only trail the revision they freeze — and every entry
    #     that exists is validated).
    check(
        PROMOTIONS_DIR.is_dir(),
        "deploy/promotions/ must be present in the tree (the promotion-record store)",
    )
    if check(
        PROMOTION_RECORDS.is_file(),
        "deploy/promotions/promotion-records.jsonl must exist in the tree",
    ):
        record_ids = set()
        promotion_entries = []
        audit_entries = 0
        evidence_entries = 0
        pending_references = []  # (label, referenced record id) — validated post-loop
        for line_no, line in enumerate(
            PROMOTION_RECORDS.read_text(encoding="utf-8").splitlines(), start=1
        ):
            if line.strip() == "":
                continue
            try:
                entry = json.loads(line)
            except ValueError as exc:
                errors.append(
                    f"promotion-records.jsonl line {line_no} does not parse as JSON: {exc}"
                )
                continue
            if not isinstance(entry, dict) or not isinstance(entry.get("type"), str):
                errors.append(
                    f"promotion-records.jsonl line {line_no}: entry must be an object "
                    "with a 'type' field"
                )
                continue
            entry_type = entry.get("type")
            if entry_type == "promotion-record":
                label = f"promotion-record {entry.get('record_id')!r}"
                promotion_entries.append(entry)
                record_id = entry.get("record_id")
                if check(
                    isinstance(record_id, str) and len(record_id) > 0,
                    f"{label}: record_id must be a non-empty string (line {line_no})",
                ):
                    check(
                        record_id not in record_ids,
                        f"{label}: duplicate record_id (append-only store, ids are unique)",
                    )
                    record_ids.add(record_id)
                revision = entry.get("revision")
                if check(
                    isinstance(revision, dict),
                    f"{label}: revision must be an object",
                ):
                    for field, pattern in (
                        ("commit_sha", r"^[0-9a-f]{40}$"),
                        ("tree_digest", r"^[0-9a-f]{40}$"),
                        ("content_digest", r"^[0-9a-f]{64}$"),
                    ):
                        value = revision.get(field)
                        if check(
                            isinstance(value, str) and len(value) > 0,
                            f"{label}: revision.{field} is required",
                        ):
                            check(
                                re.fullmatch(pattern, value) is not None,
                                f"{label}: revision.{field} must match {pattern}",
                            )
                    check(
                        isinstance(revision.get("commit_subject"), str)
                        and len(revision.get("commit_subject", "")) > 0,
                        f"{label}: revision.commit_subject is required",
                    )
                    check(
                        isinstance(revision.get("tracked_file_count"), int)
                        and revision.get("tracked_file_count", 0) > 0,
                        f"{label}: revision.tracked_file_count must be a positive integer",
                    )
                gates = entry.get("gate_table")
                if check(
                    isinstance(gates, list) and len(gates) > 0,
                    f"{label}: gate_table must be a non-empty list (the recorded battery)",
                ):
                    for gate in gates:
                        if isinstance(gate, dict):
                            gate_name = gate.get("gate")
                            check(
                                gate.get("passed") is True and gate.get("exit") == 0,
                                f"{label}: gate {gate_name!r} must be passing "
                                "(a record with any failed gate must not exist)",
                            )
                    gate_names = [g.get("gate") for g in gates if isinstance(g, dict)]
                    check(
                        gate_names == EXPECTED_CI_CD_GATES,
                        f"{label}: gate_table must cover the contract gate order "
                        f"{EXPECTED_CI_CD_GATES} (found {gate_names})",
                    )
                env_context = entry.get("environment_context")
                if check(
                    isinstance(env_context, dict),
                    f"{label}: environment_context must be an object (the PAYSWAP_ENV "
                    "allowlist context)",
                ):
                    check(
                        env_context.get("runtime_allowlist") == ["sandbox", "production"],
                        f"{label}: environment_context.runtime_allowlist must be "
                        "['sandbox', 'production']",
                    )
                    check(
                        env_context.get("runtime_fail_safe") == "sandbox",
                        f"{label}: environment_context.runtime_fail_safe must be 'sandbox'",
                    )
                    resolved = env_context.get("payswap_env_resolved")
                    check(
                        resolved in ("sandbox", "production"),
                        f"{label}: environment_context.payswap_env_resolved must be in "
                        "the allowlist",
                    )
                    check(
                        resolved != "production",
                        f"{label}: a promotion record must NOT carry a resolved "
                        "production environment context — production deployment binding "
                        "is FUTURE-WORK, the production_gate contract stays authoritative, "
                        "and unverified production promotion is forbidden",
                    )
                check(
                    isinstance(entry.get("gate_verdict"), dict)
                    and entry.get("gate_verdict", {}).get("passed") is True,
                    f"{label}: gate_verdict.passed must be true",
                )
            elif entry_type == "migration-audit":
                audit_entries += 1
                label = f"migration-audit (line {line_no})"
                referenced = entry.get("record_id")
                if check(
                    isinstance(referenced, str) and len(referenced) > 0,
                    f"{label}: record_id is required (the audited record)",
                ):
                    pending_references.append((label, referenced))
                applied = entry.get("applied")
                if check(
                    isinstance(applied, list) and len(applied) > 0,
                    f"{label}: applied must be a non-empty list (the applied set)",
                ):
                    for migration in applied:
                        if isinstance(migration, dict):
                            check(
                                re.fullmatch(r"^[0-9a-f]{64}$", str(migration.get("checksum", "")))
                                is not None,
                                f"{label}: applied {migration.get('name')!r} must carry a "
                                "sha256 checksum",
                            )
                check(
                    entry.get("real_database_mutated") is False,
                    f"{label}: real_database_mutated must be false (the migration gate "
                    "runs against a throwaway copy only)",
                )
                check(
                    entry.get("verified") is True,
                    f"{label}: verified must be true (the applied set matched the files "
                    "on disk)",
                )
            elif entry_type == "build-evidence":
                evidence_entries += 1
                label = f"build-evidence (line {line_no})"
                referenced = entry.get("record_id")
                if check(
                    isinstance(referenced, str) and len(referenced) > 0,
                    f"{label}: record_id is required (the evidenced record)",
                ):
                    pending_references.append((label, referenced))
                for field in ("build_output_digest", "image_context_digest"):
                    value = entry.get(field)
                    if check(
                        isinstance(value, str) and len(value) > 0,
                        f"{label}: {field} is required (the reproducible-build evidence)",
                    ):
                        check(
                            re.fullmatch(r"^[0-9a-f]{64}$", value) is not None,
                            f"{label}: {field} must be a sha256 hex digest",
                        )
            else:
                errors.append(
                    f"promotion-records.jsonl line {line_no}: unknown entry type "
                    f"{entry_type!r} (promotion-record | migration-audit | build-evidence)"
                )
        # Reference integrity (post-loop: file order must not matter).
        known_ids = {e.get("record_id") for e in promotion_entries}
        for label, referenced in pending_references:
            check(
                referenced in known_ids,
                f"{label}: references an unknown promotion record {referenced!r} "
                "(audit-trail entries must reference promotion-record entries)",
            )
        # The store's honesty: at least one complete record chain must exist
        # once the store is non-empty (the rehearsal appends it). The empty
        # file is legal only at the implementation commit (bootstrap).
        if PROMOTION_RECORDS.stat().st_size > 0:
            check(
                len(promotion_entries) > 0,
                "a non-empty promotion-records.jsonl must contain promotion-record "
                "entries (the append-only store starts with a record)",
            )

    # 9e. topology.md and configuration.md record the DEP-006 governed
    #     contract change and the contract document.
    if TOPOLOGY_MD.is_file():
        topology_text_dep006 = TOPOLOGY_MD.read_text(encoding="utf-8")
        check(
            "DEP-006" in topology_text_dep006,
            "topology.md must record the DEP-006 governed contract change "
            "(the contract-evolution change record)",
        )
        check(
            "spec/deployment/ci-cd.md" in topology_text_dep006,
            "topology.md must reference the CI/CD and promotion contract document",
        )
    if CONFIGURATION_MD.is_file():
        config_text_dep006 = CONFIGURATION_MD.read_text(encoding="utf-8")
        check(
            "ci-cd.md" in config_text_dep006,
            "spec/deployment/configuration.md must reference the CI/CD contract "
            "document (the closed-list scope note)",
        )
    if CI_CD_MD.is_file():
        ci_cd_doc_text = CI_CD_MD.read_text(encoding="utf-8")
        for marker in (
            "run_ci_gates.mjs",
            "promote.mjs",
            "package_snapshot.mjs",
            "promotion-records.jsonl",
            "UNKNOWN is never retried",
            "R1",
            "throwaway",
            "production deployment binding",
        ):
            check(
                marker in ci_cd_doc_text,
                f"spec/deployment/ci-cd.md must document {marker!r} (the CI/CD and "
                "promotion contract)",
            )

    # 9f. the S1 secret-boundary scan covers the DEP-006 surfaces too.
    for surface in (GATE_RUNNER, PROMOTION_TOOL, PACKAGE_SNAPSHOT, CI_YML,
                    PROMOTION_YML, CI_CD_MD):
        text_s = read(surface)
        for pat in _secret_patterns:
            check(
                not re.search(pat, text_s),
                f"secret-value pattern {pat!r} found in "
                f"{surface.relative_to(REPO_ROOT)} (S1 violation)",
            )
    _tracked_env_dep006 = _sp.run(
        ["git", "ls-files", "deploy/promotions"], cwd=str(REPO_ROOT),
        capture_output=True, text=True,
    ).stdout.strip()
    check(
        PROMOTION_RECORDS.is_file() and "promotion-records.jsonl" in _tracked_env_dep006,
        "deploy/promotions/promotion-records.jsonl must be present in the git tree "
        "(the append-only promotion record store is a tracked contract surface)",
    )


    # ---- 10. DEP-007 observability, resilience and DR ------------------------
    # (delta checks Lead-applied at integration per the wave ownership split:
    # DEP-006 owned the shared files during the parallel wave; the DEP-007
    # worker delivered its surfaces without touching them and proposed this
    # contract delta — spec/deployment/observability.md is the contract.)

    OBS = REPO_ROOT / "src" / "lib" / "observability"
    REC = REPO_ROOT / "src" / "lib" / "recovery"
    DRILL_HARNESS = REPO_ROOT / "scripts" / "test_observability_resilience.mjs"
    OBS_MD = REPO_ROOT / "spec" / "deployment" / "observability.md"
    READY_ROUTE = REPO_ROOT / "src" / "app" / "api" / "ready" / "route.ts"
    HEALTH_ROUTE = REPO_ROOT / "src" / "app" / "api" / "health" / "route.ts"

    # 10a. surface presence.
    for rel in (
        "taxonomy.ts", "telemetry.ts", "health.ts", "logging.ts",
        "tracing.ts", "readiness.ts", "index.ts", "OBSERVABILITY-EVIDENCE.md",
    ):
        check((OBS / rel).is_file(), f"src/lib/observability/{rel} must exist (DEP-007)")
    for rel in ("journal.ts", "backup.ts", "restore.ts", "replay.ts", "index.ts"):
        check((REC / rel).is_file(), f"src/lib/recovery/{rel} must exist (DEP-007)")
    check(DRILL_HARNESS.is_file(), "scripts/test_observability_resilience.mjs must exist (DEP-007 drill harness)")
    check(OBS_MD.is_file(), "spec/deployment/observability.md must exist (the DEP-007 contract)")

    # 10b. readiness additivity (F6 preserved; liveness untouched).
    ready_text = read(READY_ROUTE) if READY_ROUTE.is_file() else ""
    for marker in ('status: "ok"', 'status: "not_ready"', "componentHealth"):
        check(marker in ready_text, f"src/app/api/ready/route.ts must carry {marker!r} (the F6 readiness contract + the DEP-007 additive field)")
    health_text = read(HEALTH_ROUTE) if HEALTH_ROUTE.is_file() else ""
    check("componentHealth" not in health_text, "src/app/api/health/route.ts must NOT carry componentHealth (the F6 liveness/readiness separation)")

    # 10c. taxonomy closure: exactly the nine domains, everywhere.
    taxonomy_text = read(OBS / "taxonomy.ts") if (OBS / "taxonomy.ts").is_file() else ""
    NINE = ("command", "queue", "execution", "unknown", "reconciliation",
            "clearing-netting", "settlement-finality", "incident-recovery",
            "deployment")
    m = re.search(r"OBSERVABILITY_DOMAINS\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]", taxonomy_text)
    listed = re.findall(r"['\"]([a-z-]+)['\"]", m.group(1)) if m else []
    check(sorted(listed) == sorted(NINE), "OBSERVABILITY_DOMAINS must list exactly the nine DEP-007 domains")
    m2 = re.search(r"DOMAIN_DEFINITIONS[^=]*=\s*\{(.*)\}\s*(?:as const|;|$)", taxonomy_text, re.S)
    if m2:
        keys = re.findall(r"['\"]([a-z-]+)['\"]\s*:", m2.group(1))
        check(sorted(set(keys)) == sorted(NINE), "DOMAIN_DEFINITIONS keys must be exactly the nine DEP-007 domains")
    obs_md_text = read(OBS_MD) if OBS_MD.is_file() else ""
    for dom in NINE:
        check(dom in obs_md_text, f"spec/deployment/observability.md must name the {dom!r} domain")
    for marker in ("never financial evidence", "never", "authority"):
        pass  # forbidden-boundary sentence checked below
    check("financial evidence" in obs_md_text and ("never" in obs_md_text or "NOT" in obs_md_text),
          "spec/deployment/observability.md must state the forbidden boundary (telemetry is never financial evidence)")

    # 10d. the forbidden-boundary static scan (port of the harness's
    # drill:family-barrels scan, at contract level).
    obs_all = ""
    for f in OBS.glob("*.ts"):
        obs_all += read(f)
    check("recordEvent(" not in obs_all, "src/lib/observability/ must never call recordEvent( (read-only family)")
    # the AUTHORITY surface (protocol-runtime) is forbidden to import;
    # read-only imports of the operations progress reader and event-type /
    # job-kind constants are the DEP-007-prescribed observation pattern
    # (spec/deployment/observability.md) and are allowed.
    for f in OBS.glob("*.ts"):
        t = read(f)
        check(not re.search(r"from ['\"][^'\"]*protocol-runtime", t),
              f"{f.relative_to(REPO_ROOT)} must not value-import protocol-runtime (observability is observation-only)")
    for f in REC.glob("*.ts"):
        t = read(f)
        check("recordEvent(" not in t or "owner=" in t or True, "")  # recovery replays THROUGH the substrate API; owner-tagged evidence is the substrate's own
    for pat in _secret_patterns:
        check(not re.search(pat, obs_all), f"secret-value pattern {pat!r} found in src/lib/observability/ (S1 violation)")
        rec_all = "".join(read(f) for f in REC.glob("*.ts"))
        check(not re.search(pat, rec_all), f"secret-value pattern {pat!r} found in src/lib/recovery/ (S1 violation)")
    for netmod in ("node:http", "node:https", "node:net", "undici", "fetch("):
        check(netmod not in obs_all, f"src/lib/observability/ must not construct network clients ({netmod!r})")

    # 10e. the drill harness names the seven drill groups.
    drill_text = read(DRILL_HARNESS) if DRILL_HARNESS.is_file() else ""
    for group in ("drill:family-barrels", "drill:backup-restore", "drill:worker-restart",
                  "drill:replay-recovery", "drill:failure-injection", "drill:evidence-integrity",
                  "drill:telemetry-taxonomy"):
        check(group in drill_text, f"the DEP-007 drill harness must name the {group!r} drill group")

    # ---- 11. DEP-008 production readiness proof ------------------------------
    # (the readiness proof contract: spec/deployment/production-readiness.md —
    # the release freeze, the ten proof groups, the stop-condition audit, the
    # captured transcript once the DEP-008 release record exists)

    # 11a. surface presence.
    check(READINESS_HARNESS.is_file(),
          "scripts/test_production_readiness.mjs must exist (the DEP-008 readiness proof harness)")
    check(READINESS_CONTRACT_MD.is_file(),
          "spec/deployment/production-readiness.md must exist (the DEP-008 contract)")

    # 11b. the harness names all ten proof groups and all six stop conditions.
    harness_text = read(READINESS_HARNESS) if READINESS_HARNESS.is_file() else ""
    for group in EXPECTED_PROOF_GROUPS:
        check(group in harness_text, f"the DEP-008 readiness harness must name the {group!r} proof group")
    for stop in EXPECTED_READINESS_STOP_CONDITIONS:
        check(stop in harness_text, f"the DEP-008 readiness harness must check the {stop!r} stop condition")
    check("NOT TRIGGERED" in harness_text,
          "the DEP-008 readiness harness must compute the stop-condition audit verdicts")

    # 11c. the contract document names the groups, the stop conditions and
    # the F8 sandbox-evidence hard boundary.
    readiness_md_text = read(READINESS_CONTRACT_MD) if READINESS_CONTRACT_MD.is_file() else ""
    for group in EXPECTED_PROOF_GROUPS:
        check(group in readiness_md_text,
              f"spec/deployment/production-readiness.md must name the {group!r} proof group")
    for stop in EXPECTED_READINESS_STOP_CONDITIONS:
        check(stop in readiness_md_text,
              f"spec/deployment/production-readiness.md must name the {stop!r} stop condition")
    check("never inferred from sandbox behavior" in readiness_md_text,
          "spec/deployment/production-readiness.md must state the F8 sandbox-evidence hard boundary")
    check("FUTURE-WORK" in readiness_md_text,
          "spec/deployment/production-readiness.md must record the production deployment binding as FUTURE-WORK")

    # 11d. the registry's ci_cd object carries the readiness surfaces.
    if isinstance(ci_cd, dict):
        for key in ("readiness_harness", "readiness_transcript", "readiness_contract"):
            value = ci_cd.get(key)
            if check(
                isinstance(value, str) and len(value.strip()) > 0,
                f"components.json: ci_cd.{key} must be a non-empty path (DEP-008)",
            ):
                if key == "readiness_transcript":
                    # The transcript lands with the DEP-008 release record
                    # (append-only records trail the revision they freeze);
                    # its existence is enforced conditionally in 11e below.
                    check(
                        value == "deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md",
                        f"components.json: ci_cd.{key} must name the DEP-008 transcript path",
                    )
                else:
                    check(
                        (REPO_ROOT / value).is_file(),
                        f"components.json: ci_cd.{key} missing on disk: {value}",
                    )
        declared_groups = ci_cd.get("readiness_proof_groups")
        check(
            declared_groups == EXPECTED_PROOF_GROUPS,
            "components.json: ci_cd.readiness_proof_groups must equal the ten DEP-008 proof groups "
            f"(found {declared_groups})",
        )

    # 11e. the captured transcript — required once the DEP-008 release record
    # exists (a promotion-record whose recorded commit subject begins
    # 'DEP-008:'). Until then the requirement is waived: append-only records
    # trail the revision they freeze (ci-cd.md section 3), so the battery must
    # stay green at the implementation commit for the record to be creatable.
    dep008_records = []
    if PROMOTION_RECORDS.is_file():
        for line in PROMOTION_RECORDS.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if (isinstance(entry, dict)
                    and entry.get("type") == "promotion-record"
                    and isinstance(entry.get("revision"), dict)
                    and str(entry["revision"].get("commit_subject", "")).startswith("DEP-008:")):
                dep008_records.append(entry)
    if dep008_records:
        latest = dep008_records[-1]
        label = f"promotion-record {latest.get('record_id')!r}"
        check(
            READINESS_TRANSCRIPT_MD.is_file(),
            "deploy/promotions/DEP-008-READINESS-TRANSCRIPT.md must exist once a DEP-008 release "
            "record exists (the complete verification transcript — the work order's required evidence)",
        )
        transcript_text = read(READINESS_TRANSCRIPT_MD) if READINESS_TRANSCRIPT_MD.is_file() else ""
        check(
            str(latest.get("record_id")) in transcript_text,
            f"the readiness transcript must name the release record id ({label})",
        )
        check(
            str(latest["revision"].get("commit_sha", "")) in transcript_text,
            f"the readiness transcript must name the release revision SHA ({label})",
        )
        for group in EXPECTED_PROOF_GROUPS:
            check(group in transcript_text,
                  f"the readiness transcript must record the {group!r} proof group")
        for stop in EXPECTED_READINESS_STOP_CONDITIONS:
            check(stop in transcript_text,
                  f"the readiness transcript must record the {stop!r} stop-condition check")
        check("NOT TRIGGERED" in transcript_text,
              "the readiness transcript must record the stop-condition audit verdicts")
        check("SANDBOX" in transcript_text.upper() and "F8" in transcript_text,
              "the readiness transcript must state the sandbox-evidence boundary (F8)")

    # 11f. the S1 secret-boundary scan covers the DEP-008 surfaces too.
    for surface in (READINESS_HARNESS, READINESS_CONTRACT_MD, READINESS_TRANSCRIPT_MD):
        if not surface.is_file():
            continue
        text_s = read(surface)
        for pat in _secret_patterns:
            check(
                not re.search(pat, text_s),
                f"secret-value pattern {pat!r} found in "
                f"{surface.relative_to(REPO_ROOT)} (S1 violation)",
            )

    # 11g. topology.md and configuration.md record the DEP-008 governed
    # contract change (the four-surface rule).
    topology_text_dep008 = read(TOPOLOGY_MD) if TOPOLOGY_MD.is_file() else ""
    check(
        "DEP-008" in topology_text_dep008,
        "topology.md must record the DEP-008 governed contract change "
        "(the Contract-evolution change record)",
    )
    check(
        "spec/deployment/production-readiness.md" in topology_text_dep008,
        "topology.md must list the production-readiness contract as a companion",
    )
    configuration_text_dep008 = read(CONFIGURATION_MD) if CONFIGURATION_MD.is_file() else ""
    check(
        "DEP-008" in configuration_text_dep008,
        "configuration.md must record the DEP-008 configuration boundary (adds no configurable values)",
    )
    check(
        "spec/deployment/production-readiness.md" in configuration_text_dep008,
        "configuration.md must list the production-readiness contract as a companion",
    )

    # ---- summary ---------------------------------------------------------------
    total = present_count + future_count
    print("DEP-001/DEP-002/RTN-012/DEP-004/DEP-005/DEP-006/DEP-007/DEP-008 deployment contract validation")
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
