#!/usr/bin/env python3
"""
DEP-001 deployment contract validator.

Validates the PaySwap deployment topology and environment contract from the
repository root:

  1. deploy/contracts/components.json parses, and every component carries the
     required fields (id, name, exists_in_repository_today, owner, layer,
     authority_hosted, repository_entrypoint, environment_reachability,
     health_signal, rollback; production_gate whenever 'production' is
     reachable).
  2. Runtime environment contract agrees across registry, documents and
     implementation: the PAYSWAP_ENV allowlist is exactly {sandbox, production}
     with fail-safe 'sandbox' in components.json, spec/deployment/
     environments.md, spec/deployment/configuration.md and src/lib/
     environment.ts.
  3. Every environment in the environments.md matrix appears in components.json
     environment reachability, and the matrix set equals the canonical set.
  4. Every repository entrypoint claimed to exist today exists on disk;
     future-work components carry explicit FUTURE-WORK markers (no silent
     invention), and the only component claiming repository presence today is
     web-api-boundary.
  5. Runtime ownership model: every component is deployment-owned; protocol
     authority is hosted only by protocol-layer components.
  6. spec/deployment/topology.md agrees with the registry (all component ids
     and the normative execution-topology nodes are present).

Usage (from the repository root):

    python3 scripts/validate_deployment.py

Exit codes: 0 = contract valid (summary printed); 1 = validation failure
(errors listed).

Contract evolution is governed: changing the component set, the environment
set or the PAYSWAP_ENV allowlist requires updating components.json, the
spec/deployment/* documents and this validator in the same work item.

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
APP_ENVIRONMENT_TS = REPO_ROOT / "src" / "lib" / "environment.ts"

EXPECTED_BASE_BRANCH = "main"
EXPECTED_BASE_SHA = "f934a76f20efbd6e238605d8e7320495974a870e"
EXPECTED_CONTRACT = "payswap-deployment-components"
EXPECTED_PRESENT_COMPONENTS = {"web-api-boundary"}
EXPECTED_ENVIRONMENTS = {"development", "test-ci", "sandbox", "staging", "production"}
EXPECTED_RUNTIME_VAR = "PAYSWAP_ENV"
EXPECTED_RUNTIME_ALLOWLIST = {"sandbox", "production"}
EXPECTED_RUNTIME_FAIL_SAFE = "sandbox"
ALLOWLIST_DOC_STRING = "sandbox | production"
MATRIX_HEADING = "## Environment matrix"
DIAGRAM_ANCHORS = ("Web / API boundary", "Durable command path")

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
        f"components.json: base_sha must be the DEP-001 base {EXPECTED_BASE_SHA!r} "
        "(changing the declared base is a governed contract change that updates "
        "this validator)",
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

    # ---- 4. honesty lock: only the web boundary exists today ----------------
    check(
        present_ids == EXPECTED_PRESENT_COMPONENTS,
        f"components claiming repository presence today must equal "
        f"{sorted(EXPECTED_PRESENT_COMPONENTS)} (found {sorted(present_ids)}); "
        "adding a present component is a governed contract change that updates "
        "this validator",
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
            "topology.md must carry FUTURE-WORK markers for not-yet-in-repo components",
        )

    # ---- summary ---------------------------------------------------------------
    total = present_count + future_count
    print("DEP-001 deployment contract validation")
    print(f"  base: {registry.get('base_branch')} @ {registry.get('base_sha')}")
    print(
        f"  components: {total} total, {present_count} present today, "
        f"{future_count} future-work"
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
