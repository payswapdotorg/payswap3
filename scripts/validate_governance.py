#!/usr/bin/env python3
# PaySwap3 governance validator (work item GOV-001).
#
# Invocation contract (run from the repository root):
#
#     python3 scripts/validate_governance.py
#
# Checks performed:
#
#   [1] Every authority path declared in the Authorities section of
#       agents/architect-prompt.md exists on disk.
#         - A present path is validated: directories must be non-empty and
#           .json files must parse.
#         - An absent path that belongs to a declared sibling wave is
#           reported as "MISSING (sibling wave)" and is NOT a hard failure;
#           when such a path is present, it IS validated like any other.
#         - Any other absent path is a hard failure naming the missing path.
#   [2] spec/governance/governance-model.json parses, contains the five
#       anti-drift classification values, and defines the three roles.
#   [3] agents/schemas/execution-context.schema.json parses, declares JSON
#       Schema draft 2020-12, requires exactly the thirteen contract
#       properties with additionalProperties false, and every embedded
#       example validates against the schema (built-in minimal validator).
#   [4] The GOV-001 governance surface itself is present (self-check).
#
# Exit codes: 0 = PASS, 1 = FAIL (with a numbered error list).
# Dependencies: none beyond the Python 3.8+ standard library.

import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARCHITECT_PROMPT_PATH = "agents/architect-prompt.md"
GOVERNANCE_MODEL_PATH = "spec/governance/governance-model.json"
EXECUTION_CONTEXT_SCHEMA_PATH = "agents/schemas/execution-context.schema.json"

EXPECTED_CLASSIFICATIONS = [
    "WITHIN_SCOPE",
    "OUT_OF_SCOPE",
    "CONTRACT_BLOCKER",
    "ARCHITECTURE_BLOCKER",
    "ENVIRONMENT_BLOCKER",
]

EXPECTED_EXECUTION_CONTEXT_PROPERTIES = [
    "repository",
    "base_sha",
    "work_item_id",
    "architecture_authority",
    "hard_dependencies",
    "contract_dependencies",
    "owned_surfaces",
    "forbidden_surfaces",
    "assurance_profile",
    "required_proofs",
    "dogfooding_requirements",
    "checkpoint_contract",
    "stop_conditions",
]

# Paths that the sibling-wave program is expected to materialize on surfaces
# disjoint from GOV-001. While such a path is absent it is reported as
# "MISSING (sibling wave)" (not a hard failure). When it is present it is
# validated exactly like any other authority path. Every other missing
# authority path is a hard failure. This map is maintained by post-merge
# reconciliation as waves merge.
SIBLING_WAVE_PATHS = {
    # Protocol wave (ARCH-001; merged at main @ b9737e9b...).
    "spec/architecture/v0.1/": "protocol wave (ARCH-001, merged)",
    "spec/work-orders/": "protocol wave (ARCH-001, merged)",
    "spec/development-state/program-state.json": "protocol wave (ARCH-001, merged)",
    "spec/development-state/dependency-state.json": "protocol wave (ARCH-001, merged)",
    "spec/development-state/frontier-state.json": "protocol wave (ARCH-001, merged)",
    "spec/registry/protocol-registry.json": "protocol wave (ARCH-001, merged)",
    # Product/UI wave (dispatched on disjoint surfaces; merge pending).
    "spec/product/ux-architecture-v0.2.md": "product wave (merge pending)",
    "spec/product/implementation-roadmap.md": "product wave (merge pending)",
    "spec/product/work-items.md": "product wave (merge pending)",
    "spec/product/work-orders/": "product wave (merge pending)",
    "spec/development-state/product-program-state.json": "product wave (merge pending)",
    # System/deployment wave (pending; disjoint from governance surfaces).
    "spec/system-architecture.md": "system wave (merge pending)",
    "spec/system-reconciliation.md": "system wave (merge pending)",
    "spec/system-work-items.md": "system wave (merge pending)",
    "agents/successor-tech-lead-bootstrap.md": "system wave (successor bootstrap, merge pending)",
}

GOV001_SURFACE = [
    "spec/governance/source-of-truth.md",
    "spec/governance/governance-model.json",
    "spec/governance/agent-dispatch.md",
    "spec/governance/implementation-protocol.md",
    "spec/governance/parallel-execution.md",
    "spec/governance/drift-control.md",
    "spec/governance/dogfooding-protocol.md",
    "agents/schemas/execution-context.schema.json",
    "scripts/validate_governance.py",
]

JSON_TYPE_MAP = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


def repo_path(relative_path):
    return os.path.join(REPO_ROOT, *relative_path.split("/"))


def read_text(relative_path):
    with open(repo_path(relative_path), "r", encoding="utf-8") as handle:
        return handle.read()


def extract_authority_paths(errors):
    """Return the authority paths declared in architect-prompt.md, in order.

    Only the Authorities section (the level-2 heading named Authorities, up
    to the next level-2 heading) is scanned, because that section is where
    authorities are declared. Backtick-quoted tokens beginning with spec/ or
    agents/ are treated as repository paths.
    """
    if not os.path.isfile(repo_path(ARCHITECT_PROMPT_PATH)):
        errors.append(
            "missing %s (cannot extract declared authority paths)"
            % ARCHITECT_PROMPT_PATH
        )
        return []
    lines = read_text(ARCHITECT_PROMPT_PATH).splitlines()
    paths = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## Authorities"):
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if not in_section:
            continue
        for match in re.finditer(r"`([^`\n]+)`", line):
            token = match.group(1).strip()
            if token.startswith("spec/") or token.startswith("agents/"):
                if token not in paths:
                    paths.append(token)
    if not paths:
        errors.append(
            "no authority paths found in the Authorities section of %s"
            % ARCHITECT_PROMPT_PATH
        )
    return paths


def check_authority_path(relative_path, errors):
    """Check one declared authority path. Returns (label, detail).

    Hard failures are appended to errors. Sibling-wave absences are reported
    as MISSING (sibling wave) and are not hard failures.
    """
    absolute = repo_path(relative_path)
    if not os.path.exists(absolute):
        wave = SIBLING_WAVE_PATHS.get(relative_path)
        if wave is not None:
            return ("MISSING (sibling wave)", wave)
        errors.append(
            "missing authority path (hard failure): %s" % relative_path
        )
        return ("MISSING", "not attributable to any declared sibling wave")
    if os.path.isdir(absolute):
        try:
            entries = os.listdir(absolute)
        except OSError as exc:
            errors.append(
                "cannot inspect authority directory %s: %s" % (relative_path, exc)
            )
            return ("ERROR", "unreadable directory")
        if not entries:
            errors.append(
                "authority directory exists but is empty: %s" % relative_path
            )
            return ("EMPTY", "directory exists but contains no entries")
        return ("OK", "directory, %d entries" % len(entries))
    if relative_path.endswith(".json"):
        try:
            json.loads(read_text(relative_path))
        except (OSError, ValueError) as exc:
            errors.append(
                "authority JSON file does not parse: %s: %s" % (relative_path, exc)
            )
            return ("INVALID JSON", "file exists but does not parse")
        return ("OK", "file, valid JSON")
    return ("OK", "file")


def find_classification_enum(node):
    """Return the first list of strings containing all five expected
    anti-drift classification values, or None."""
    if isinstance(node, list):
        if node and all(isinstance(item, str) for item in node):
            if set(EXPECTED_CLASSIFICATIONS).issubset(node):
                return node
        for item in node:
            found = find_classification_enum(item)
            if found is not None:
                return found
    elif isinstance(node, dict):
        for value in node.values():
            found = find_classification_enum(value)
            if found is not None:
                return found
    return None


def json_type_matches(type_name, instance):
    if type_name == "integer":
        return isinstance(instance, int) and not isinstance(instance, bool)
    if type_name == "number":
        return isinstance(instance, (int, float)) and not isinstance(instance, bool)
    expected = JSON_TYPE_MAP.get(type_name)
    if expected is None:
        return True
    return isinstance(instance, expected)


def validate_against_schema(schema, instance, path, errors):
    """Minimal JSON Schema validation covering the keywords used by
    execution-context.schema.json: type, enum, pattern, minLength, minItems,
    uniqueItems, items, required, properties, additionalProperties. Unknown
    keywords are ignored. This is intentionally not a full draft 2020-12
    implementation; the repository validator must stay dependency-free."""
    if not isinstance(schema, dict):
        return
    if "type" in schema and not json_type_matches(schema["type"], instance):
        errors.append("%s: expected type %s" % (path, schema["type"]))
        return
    if "enum" in schema and instance not in schema["enum"]:
        errors.append("%s: value is not in the schema enum" % path)
    if isinstance(instance, str):
        if "pattern" in schema:
            try:
                if re.search(schema["pattern"], instance) is None:
                    errors.append(
                        "%s: does not match pattern %s"
                        % (path, schema["pattern"])
                    )
            except re.error as exc:
                errors.append("%s: schema pattern is invalid (%s)" % (path, exc))
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(
                "%s: length %d is below minLength %s"
                % (path, len(instance), schema["minLength"])
            )
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(
                "%s: %d items is below minItems %s"
                % (path, len(instance), schema["minItems"])
            )
        if schema.get("uniqueItems") is True:
            seen = []
            for item in instance:
                if item in seen:
                    errors.append("%s: duplicate item %r" % (path, item))
                    break
                seen.append(item)
        items_schema = schema.get("items")
        if isinstance(items_schema, dict):
            for index, item in enumerate(instance):
                validate_against_schema(
                    items_schema, item, "%s[%d]" % (path, index), errors
                )
    if isinstance(instance, dict):
        for required_key in schema.get("required", []):
            if required_key not in instance:
                errors.append(
                    "%s: missing required property %s" % (path, required_key)
                )
        properties = schema.get("properties", {})
        allow_additional = schema.get("additionalProperties", True)
        for key in sorted(instance):
            value = instance[key]
            if key in properties:
                validate_against_schema(
                    properties[key], value, "%s/%s" % (path, key), errors
                )
            elif allow_additional is False:
                errors.append(
                    "%s: additional property %s is not allowed" % (path, key)
                )


def check_governance_model(errors):
    ok_lines = []
    if not os.path.isfile(repo_path(GOVERNANCE_MODEL_PATH)):
        errors.append("missing %s" % GOVERNANCE_MODEL_PATH)
        return ok_lines
    try:
        model = json.loads(read_text(GOVERNANCE_MODEL_PATH))
    except (OSError, ValueError) as exc:
        errors.append("%s does not parse: %s" % (GOVERNANCE_MODEL_PATH, exc))
        return ok_lines
    ok_lines.append("parses as JSON")
    classification_enum = find_classification_enum(model)
    if classification_enum is None:
        errors.append(
            "%s does not contain all five anti-drift classification values (%s)"
            % (GOVERNANCE_MODEL_PATH, ", ".join(EXPECTED_CLASSIFICATIONS))
        )
    else:
        ok_lines.append(
            "contains all five anti-drift classification values: %s"
            % ", ".join(classification_enum)
        )
    roles = model.get("roles") if isinstance(model, dict) else None
    expected_roles = ("Architect", "Tech Lead", "Worker")
    if not isinstance(roles, dict) or any(
        role not in roles for role in expected_roles
    ):
        errors.append(
            "%s must define roles for %s"
            % (GOVERNANCE_MODEL_PATH, ", ".join(expected_roles))
        )
    else:
        ok_lines.append("defines the roles Architect, Tech Lead, and Worker")
    return ok_lines


def check_execution_context_schema(errors):
    ok_lines = []
    schema_path = repo_path(EXECUTION_CONTEXT_SCHEMA_PATH)
    if not os.path.isfile(schema_path):
        errors.append("missing %s" % EXECUTION_CONTEXT_SCHEMA_PATH)
        return ok_lines
    try:
        schema = json.loads(read_text(EXECUTION_CONTEXT_SCHEMA_PATH))
    except (OSError, ValueError) as exc:
        errors.append("%s does not parse: %s" % (EXECUTION_CONTEXT_SCHEMA_PATH, exc))
        return ok_lines
    ok_lines.append("parses as JSON")
    if not isinstance(schema, dict):
        errors.append(
            "%s root must be a JSON object" % EXECUTION_CONTEXT_SCHEMA_PATH
        )
        return ok_lines
    declared = schema.get("$schema", "")
    if "2020-12" not in declared:
        errors.append(
            "%s must declare $schema https://json-schema.org/draft/2020-12/schema"
            % EXECUTION_CONTEXT_SCHEMA_PATH
        )
    else:
        ok_lines.append("declares JSON Schema draft 2020-12")
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    if isinstance(required, list) and set(required) == set(
        EXPECTED_EXECUTION_CONTEXT_PROPERTIES
    ):
        ok_lines.append(
            "requires exactly the %d contract properties"
            % len(EXPECTED_EXECUTION_CONTEXT_PROPERTIES)
        )
    else:
        errors.append(
            "%s required must be exactly: %s"
            % (
                EXECUTION_CONTEXT_SCHEMA_PATH,
                ", ".join(EXPECTED_EXECUTION_CONTEXT_PROPERTIES),
            )
        )
    if isinstance(properties, dict) and set(properties) == set(
        EXPECTED_EXECUTION_CONTEXT_PROPERTIES
    ):
        ok_lines.append("properties define exactly those properties")
    else:
        errors.append(
            "%s properties must define exactly: %s"
            % (
                EXECUTION_CONTEXT_SCHEMA_PATH,
                ", ".join(EXPECTED_EXECUTION_CONTEXT_PROPERTIES),
            )
        )
    if schema.get("additionalProperties") is False:
        ok_lines.append("sets additionalProperties to false at the root")
    else:
        errors.append(
            "%s must set additionalProperties to false at the root"
            % EXECUTION_CONTEXT_SCHEMA_PATH
        )
    examples = schema.get("examples")
    if not isinstance(examples, list) or not examples:
        errors.append(
            "%s must embed a non-empty examples array"
            % EXECUTION_CONTEXT_SCHEMA_PATH
        )
        return ok_lines
    validated = 0
    for index, example in enumerate(examples):
        example_errors = []
        validate_against_schema(
            schema, example, "examples[%d]" % index, example_errors
        )
        if example_errors:
            for message in example_errors:
                errors.append(
                    "%s example %d invalid: %s"
                    % (EXECUTION_CONTEXT_SCHEMA_PATH, index, message)
                )
        else:
            validated += 1
    if validated:
        ok_lines.append(
            "%d embedded example(s) validate against the schema" % validated
        )
    return ok_lines


def check_gov001_surface(errors):
    missing = [
        relative
        for relative in GOV001_SURFACE
        if not os.path.exists(repo_path(relative))
    ]
    if missing:
        for relative in missing:
            errors.append(
                "missing GOV-001 governance surface file: %s" % relative
            )
        return "FAIL: %d of %d files missing" % (len(missing), len(GOV001_SURFACE))
    return "OK: %d of %d files present" % (len(GOV001_SURFACE), len(GOV001_SURFACE))


def main():
    errors = []
    print("PaySwap3 governance validation")
    print("repository root: %s" % REPO_ROOT)
    print("-" * 72)

    print(
        "[1] authority paths declared in %s (Authorities section)"
        % ARCHITECT_PROMPT_PATH
    )
    authority_paths = extract_authority_paths(errors)
    present = 0
    sibling_pending = 0
    failed = 0
    for relative_path in authority_paths:
        label, detail = check_authority_path(relative_path, errors)
        if label == "OK":
            present += 1
        elif label == "MISSING (sibling wave)":
            sibling_pending += 1
        else:
            failed += 1
        print("      %s%s — %s" % (label.ljust(24), relative_path, detail))
    print(
        "      summary: %d declared, %d present, %d missing (sibling wave), %d failed"
        % (len(authority_paths), present, sibling_pending, failed)
    )

    print("")
    print("[2] %s" % GOVERNANCE_MODEL_PATH)
    for line in check_governance_model(errors):
        print("      OK — %s" % line)

    print("")
    print("[3] %s" % EXECUTION_CONTEXT_SCHEMA_PATH)
    for line in check_execution_context_schema(errors):
        print("      OK — %s" % line)

    print("")
    print("[4] GOV-001 governance surface (self-check)")
    print("      %s" % check_gov001_surface(errors))

    print("")
    print("-" * 72)
    if errors:
        print(
            "RESULT: FAIL (%d error%s)"
            % (len(errors), "" if len(errors) == 1 else "s")
        )
        for index, message in enumerate(errors, 1):
            print("  ERROR %d: %s" % (index, message))
        return 1
    print(
        "RESULT: PASS — %d authority paths validated (%d present, %d sibling-wave pending), 0 errors"
        % (len(authority_paths), present, sibling_pending)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
