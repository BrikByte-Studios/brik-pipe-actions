# Container Build Contract v1 (PIPE-CORE-1.2.1)

> This is the canonical interface contract for BrikByteOS container build workflows.
> It is referenced by ADR-0002 and must remain stable across v1 releases.

## Inputs (workflow_call)

### Required (v1)
- `builder` (string): `buildx|kaniko`
- `mode` (string): `dry_run|build_only|build_and_push`
- `context` (string): path to build context (default `"."`)
- `dockerfile` (string): path to Dockerfile (default `"Dockerfile"`)
- `image_name` (string): image name without registry prefix (e.g. `org/service`)
- `registry` (string): registry host (e.g. `ghcr.io`)
- `push` (boolean): derived from mode; allowed as explicit override only if consistent
- `tags` (string): comma-separated tags (e.g. `sha-abc123,v1.2.3`)
- `cache` (string): `enabled|disabled`

### Optional (v1)
- `cache_mode` (string):
  - Buildx: `gha|registry`
  - Kaniko: `registry`
- `cache_ref` (string): remote cache ref (registry cache image)
- `build_args` (string): newline-separated `KEY=VALUE` pairs (sanitized)
- `platforms` (string): comma-separated (default single arch in v1)
- `working_directory` (string): default `"."`
- `labels` (string): newline-separated `KEY=VALUE` labels (sanitized)

## Outputs

- `builder_used` (string): `buildx|kaniko`
- `image_ref` (string): full image ref(s) produced/pushed
- `digest` (string): image digest (if available)
- `audit_bundle_path` (string): `.audit/PIPE-IMAGE`

## Required Behaviors

1) If `mode=build_and_push`, workflow MUST:
- enforce SHA tag present in `tags`
- attempt to record digest evidence

2) If `mode=dry_run`, workflow MUST:
- validate context + Dockerfile exist
- validate tag policy for the requested mode
- not require registry auth

3) Evidence MUST be produced with `if: always()`.

## Tag Policy (v1 baseline)

- If `mode=build_and_push`:
  - MUST include at least one immutable SHA tag (e.g. `sha-<shortsha>` or `<fullsha>`)
- If release context indicates SemVer:
  - SHOULD include `vX.Y.Z` (enforced by PIPE-CORE-1.2.5 policy gate)

> Exact tag formats may be tightened by ADR-PIPE-012 later.
