---
id: "ADR-0001"                # e.g. ADR-0003 (4-digit padded)
seq: 1                        # integer, matches filename prefix
title: "Define BrikByte Build Contract, Inputs, and Override Law"
status: "Accepted"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2025-12-30              # YYYY-MM-DD
review_after: 2026-06-29

authors:
  - "@BrikByte-Studios/platform-leads"

area:
  - "PIPE"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Define BrikByte Build Contract, Inputs, and Override Law

## Status

- **Status:** Accepted
- **Date:** 2025-12-30
- **Review After:** 2026-06-29
- **Authors:** @BrikByte-Studios/platform-leads
- **Area:** PIPE
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS Pipelines (PIPE-CORE-1) requires a stable, enforceable build baseline across stacks (Node, Python, Java, .NET, Go). Without a contract:
- repos duplicate YAML and diverge in build order, commands, and outputs
- “override” behavior becomes ad hoc edits to workflows
- schema validation (PIPE-CORE-1.1.4) cannot reliably enforce correctness
- downstream stages (tests/security/packaging/release) inherit inconsistent behavior
- audit readiness is weakened if evidence is missing on failures

At the same time, we must avoid a contract so strict that adoption becomes painful. Therefore v1 requires a minimal contract with explicit “override law” that preserves standardization while allowing controlled customization.

This ADR defines the normative Build Contract and the legal override rules that all build templates and validators must implement

---

## 2. Decision

We will standardize on a **fixed build stage sequence** for all supported stacks, backed by:
1. a canonical reusable workflow per stack (workflow_call)
2. a single authoritative runtime/toolchain matrix (runtime-matrix.yml) for defaults
3. explicit, minimal, consistent workflow_call input names
4. an “override law” that allows customization **without allowing snowflake pipelines**
5. audit evidence export that runs **even when builds fail** (`if: always()`)

This decision is binding for:
- **PIPE-CORE-1.1.2** reusable build workflows
- **PIPE-CORE-1.1.4** schema + validator logic
- **PIPE-CORE-1.1.5** documentation
- **PIPE-CORE-1.1.6** template regression tests

---

### 2.1 Normative Build Contract (MUST / SHOULD / MAY)
#### 2.1.1 Canonical Stage Sequence (MUST)

All build templates MUST execute the following stages in this exact order:
1. **Checkout**
2. **Resolve Runtime Defaults** (from runtime-matrix.yml; override allowed)
3. **Setup Runtime**
4. **Restore / Install Dependencies**
5. **Lint** (optional hook)
6. **Test** (default on)
7. **Build**
8. **Export Evidence Bundle (.audit)** (always)
9. **Upload Evidence Artifact** (optional)
10. **Emit Verdict Outputs** (always)

Stage reordering is forbidden in v1 (see Override Law).

#### 2.1.2 Stage Semantics (MUST)

For each stage:
- Restore/Install MUST fail the job on failure (no silent failures).
- Lint/Test stages MUST be skippable only via standard flags (run_lint/run_tests).
- Build MUST always run (unless the job is already hard-failed before it begins).
- Evidence export MUST run with `if: always()`.

#### 2.1.3 Exit Code Semantics (MUST)
- A failing stage MUST fail the step (no `|| true` patterns).
- Evidence export MUST record the outcomes of lint/test/build into evidence.
- Workflow output `build_verdict` MUST be deterministic:
  - `pass` only if Build succeeded and (Test/Lint succeeded or were skipped)
  - `fail` otherwise

#### 2.1.4 Evidence Bundle Contract (MUST)

Every build workflow run MUST produce an evidence bundle at:
```pgsql
.audit/PIPE-BUILD/
  metadata.json
  runtime.json
  commands.json
  results.json
  logs/
    install.log
    lint.log   (if run)
    test.log   (if run)
    build.log
  artifact-summary.json
```

Evidence export MUST still occur on failures (audit gaps are not allowed).

#### 2.1.5 Runtime/Toolchain Defaults (MUST)
- Defaults MUST be resolved from `docs/pipelines/runtime-matrix.yml`.
- `runtime_version` override MAY be provided by caller; it MUST be validated later by validators (PIPE-CORE-1.1.4).
- tool defaults per runtime:
  - Node: package_manager default from matrix (npm/pnpm/yarn)
  - Python: package_manager default from matrix (pip/poetry)
  - Java: build_tool default from matrix (maven/gradle)
  - .NET: build tool is dotnet (LTS-only)
  - Go: build tool is go

---

### 2.2 Standard Workflow Inputs (v1 Contract)
#### 2.2.1 Cross-stack Inputs (MUST)

All build workflows MUST support these workflow_call inputs with the same names:
- `working_directory` (string, default `"."`)
- `runtime_version` (string, default `""`) — override (otherwise matrix default)
- `run_lint` (boolean, default `false`)
- `run_tests` (boolean, default `true`)
- `lint_command` (string, default `""`)
- `test_command` (string, default `""`)
- `build_command` (string, default `""`)
- `upload_artifacts` (boolean, default `true`)
- `artifact_paths` (string, default stack convention)

#### 2.2.2 Stack-specific Inputs (MAY)

Only when needed per stack:
- Node: `package_manager` (string, default `""`)
- Python: `package_manager` (string, default `""`)
- Java: `build_tool` (string, default `""`)

No other stack-specific inputs are allowed in v1 without platform approval.

#### 2.2.3 Outputs (MUST)

All workflows MUST output:
- `build_verdict` (pass|fail)
- `runtime_used` (resolved runtime version)
- `audit_bundle_path` (typically `.audit/PIPE-BUILD`)

---
### 2.3 Override Law (Allowed vs Forbidden)
#### 2.3.1 Allowed Overrides (MUST allow)

Repos MAY override only the following via inputs or `.brik/build.yml` (when validator is introduced):
- `working_directory`
- `runtime_version` (must remain within supported matrix when enforcement is enabled)
- `package_manager` / `build_tool` (must be in matrix allowed list)
- `run_lint`, `run_tests`, `upload_artifacts`
- `lint_command`, `test_command`, `build_command`

These overrides are permitted because they do not change the standard lifecycle; they only substitute commands/tools within the same contract.

#### 2.3.2 Forbidden Overrides (MUST reject / MUST not provide)

The following are forbidden in v1:
- Reordering stages (e.g., build before test, skipping install, etc.)
- Disabling evidence export
- Custom “wrapper scripts” that hide failures (`|| true`, swallowing exit codes)
- Running arbitrary untracked steps that materially change build meaning (e.g., publishing, releasing, deploying)
- Bypassing policy validation on protected branches (future enforcement note)

Violations MUST fail validation once PIPE-CORE-1.1.4 enforcement is enabled.

---
### 2.4 Conventions (Recommended Defaults)

These conventions guide defaults but do not force repo refactors in v1:
- Node:
  - source: `src/`, tests: `test|tests|__tests__`, output: `dist/`
- Python:
  - tests: `tests/`, output: `__pycache__/` (v1 minimal); packaging later
- Java:
  - Maven output `target/`, Gradle output `build/`
- .NET:
  - output `bin/`, `obj/`
- Go:
  - module root, output commonly `bin/` (project-specific)

Workflows SHOULD default to these paths for `artifact_paths`.

---

## 3. Alternatives Considered

### 3.1 Option A — No Standard Contract (Rejected)
**Pros:**  
- zero initial constraints
- teams move fast locally

**Cons:**  
- drift, inconsistent builds, brittle downstream stages
- no enforceable validation
- audit evidence inconsistent or missing

**Why Rejected:**  
- does not satisfy PIPE-CORE-1 goals (standardization + audit readiness)

---

### 3.2 Option B — Extremely Strict, No Overrides (Rejected)
**Pros:**  
- maximum uniformity
- easiest to validate

**Cons:**  
- high adoption friction
- breaks many real repos (monorepos, custom test commands, tool choices)
- leads to “shadow pipelines” or forks

**Why Rejected:**  
- would stall adoption and push teams to bypass governance

---

### 3.3 Option C — Per-Repo Custom Workflows with Shared Docs Only (Rejected)
**Pros:**  
- some consistency from guidance
- minimal platform engineering

**Cons:**  
- docs are not enforcement
- inconsistent evidence export
- no shared interface for downstream tooling

**Why Rejected:**  
- insufficient for governance + deterministic pipeline behavior

---

### 3.4 **Option D — Reusable Workflows + Minimal Contract + Override Law (✔ Chosen)**
**Pros:**  
- consistent baseline across stacks
- minimal adoption friction (workflow_call)
- validators can enforce structure early
- evidence export is standardized and audit-ready
- controlled flexibility via explicit override law

**Cons / Trade-offs:**  
- platform must maintain templates + contract
- some repos will need minor alignment (scripts naming, working_directory) 

**Why Accepted:**  
- best balance of standardization, governance alignment, and developer experience
- enables predictable downstream stages without freezing teams 

---

## 4. Consequences

### Positive
- One “golden path” build interface across stacks
- Deterministic stage ordering enables stable pipeline extensions
- Evidence consistency improves audit readiness and debugging
- Validator rules become clear and enforceable 

### Negative / Risks
- Some repos lack lint scripts (`npm run lint`) and will fail when lint enabled
- Tooling prerequisites (pnpm/yarn, golangci-lint) can cause friction
- Teams may attempt forbidden overrides to “make it work”

### Mitigations
- Defaults keep lint optional in v1 (`run_lint=false`)
- Allow command overrides without stage reorder
- Provide smoke-test example repos and docs
- Add enforcement gradually (warn → block) on protected branches

---

## 5. Implementation Notes

### Where this is implemented (repos)
- **brik-pipe-actions**
  - `.github/workflows/build-*.yml` (reusable workflows)
  - `.github/actions/resolve-runtime` (reads runtime-matrix defaults)
  - `.github/actions/export-build-evidence` (writes `.audit/PIPE-BUILD`)
  - `docs/pipelines/runtime-matrix.yml` (authoritative defaults)
- **brik-pipe-cli** (later consumption)
  - `validate` subcommand mirrors contract + matrix rules
- **brik-pipe-examples**
  - minimal adopters per stack for smoke/regression validation

### Enforcement plan (v1 → v2)
- v1: workflows implement the contract; validators may warn first
- v1.x: contract remains stable; add features without breaking input names
- v2: consider stricter enforcement, richer artifact packaging, caching, monorepo first-class

---

## 6. References
- `docs/pipelines/runtime-matrix.yml`
- `.github/workflows/build-node.yml` / `build-python.yml` / `build-java.yml` / `build-dotnet.yml` / `build-go.yml`
- PIPE-CORE-1.1.2 / PIPE-CORE-1.1.4 / PIPE-CORE-1.1.6 tracking issues

