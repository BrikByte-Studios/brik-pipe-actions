# BrikByteOS Build Config — `.brik/build.yml` (v1)

## Purpose
`.brik/build.yml` declares a repository’s build intent in a **standard, validated** form.

This prevents:
- per-repo YAML snowflakes
- late-stage failures from misconfiguration
- drift across stacks (node/python/java/dotnet/go)

Validation is enforced early in CI and produces audit evidence under `.audit/PIPE-BUILD/validation/`.

---

## MUST / SHOULD / MAY (Contract Language)

### MUST
- MUST include `schemaVersion: 1`
- MUST include `stack: node|python|java|dotnet|go`
- MUST not reorder build stages (Install → Lint → Test → Build → Evidence)
- MUST not hide failures in commands (e.g., `|| true`, `exit 0`, `set +e`) in v1
- MUST pass validator on protected branches (policy enforced by workflows)

### SHOULD
- SHOULD keep commands blank unless you have a real override
- SHOULD rely on runtime matrix defaults unless the repo truly requires an override
- SHOULD keep `workingDirectory` as `"."` unless monorepo structure requires it

### MAY
- MAY override `runtime.version` if allowed by runtime matrix
- MAY override `tool.kind` if allowed for the stack
- MAY override commands (install/lint/test/build) while preserving stage semantics
- MAY disable lint/tests via flags (build remains mandatory)

---

## Schema (v1 fields)

```yml
schemaVersion: 1
stack: node|python|java|dotnet|go
workingDirectory: "."

runtime:
  version: ""            # optional override

tool:
  kind: ""               # optional override (validated by stack)

commands:
  install: ""
  lint: ""
  test: ""
  build: ""

flags:
  runLint: false
  runTests: true

artifacts:
  paths:
    - "dist/**"
```

---
## Defaults (if omitted)

Defaults are resolved deterministically from:

1. `docs/pipelines/runtime-matrix.yml` (canonical)
2. stack/tool defaults (Build Contract)

Resolved config is exported to:  
`.audit/PIPE-BUILD/validation/build-config.resolved.json`

---

## Common fixes
### “TOOL_NOT_ALLOWED”

You chose a tool not valid for the stack.
- Node: npm|pnpm|yarn
- Python: pip|poetry
- Java: maven|gradle
- Dotnet: dotnet
- Go: go

### “RUNTIME_VERSION_NOT_ALLOWED”

Your runtime version is not allowed by runtime matrix allowlist.
Pick one of the matrix-supported versions or remove the override.

### “UNSAFE_COMMAND_PATTERN”

Remove patterns that hide failure:
- `|| true`
- `exit 0`
- `set +e`

---
## Evidence

On every run (pass/fail), validation evidence is written:

`.audit/PIPE-BUILD/validation/`
- build-config.raw.yml
- build-config.resolved.json
- validation-report.json
- validation-summary.md


---

## CI performance target (<5s)
This validator is:
- filesystem-only
- no network calls
- small dependency set (Ajv + yaml)
- reports timings in `validation-report.json`