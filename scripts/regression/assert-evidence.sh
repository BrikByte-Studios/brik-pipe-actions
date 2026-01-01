#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Evidence assertions for PIPE-CORE-1.1.6
#
# Validates `.audit/PIPE-BUILD` evidence exists and is structurally sane.
#
# Env:
#   EVIDENCE_ROOT      - root folder to check (stack-scoped)
#   EXPECT_VALIDATION  - "true" => require validation files
#   EXPECT_SUCCESS     - "true" => require smoke metadata + stage logs
# -----------------------------------------------------------------------------

ROOT="${EVIDENCE_ROOT:?EVIDENCE_ROOT is required}"
EXPECT_VALIDATION="${EXPECT_VALIDATION:-true}"
EXPECT_SUCCESS="${EXPECT_SUCCESS:-true}"

echo "🔎 Asserting evidence at: $ROOT"
test -d "$ROOT" || { echo "❌ Evidence root not found: $ROOT"; exit 1; }

require_file() {
  local f="$1"
  test -f "$f" || { echo "❌ Missing required file: $f"; exit 1; }
}

# On both pass/fail we require validator evidence exists somewhere.
if [ "$EXPECT_VALIDATION" = "true" ]; then
  # For smoke success path we check validator output in the main validation folder.
  # For fail path we check stack-specific folder created by fail-validation.mjs.
  if [ -f "$ROOT/validation-report.json" ]; then
    require_file "$ROOT/validation-report.json"
    require_file "$ROOT/validation-summary.md"
  else
    # In PASS path: smoke evidence root is `.audit/PIPE-BUILD/smoke/<stack>`
    # but validator evidence is `.audit/PIPE-BUILD/validation/...`
    require_file ".audit/PIPE-BUILD/validation/validation-report.json"
    require_file ".audit/PIPE-BUILD/validation/validation-summary.md"
  fi
fi

if [ "$EXPECT_SUCCESS" = "true" ]; then
  require_file "$ROOT/metadata.json"
  require_file "$ROOT/install/command.log"
  # Lint/test may be skipped per flags; build is mandatory in v1 smoke runner.
  require_file "$ROOT/build/command.log"

  # Validate required metadata keys (minimal governance requirement)
  node - <<'NODE'
const fs = require("fs");
const p = process.env.EVIDENCE_ROOT + "/metadata.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
const required = ["repo","sha","run_id","workflow","stack","runtime_used","tool_used","timestamp"];
for (const k of required) {
  if (!(k in m)) { console.error("❌ metadata missing key:", k); process.exit(1); }
}
console.log("✅ metadata.json keys OK");
NODE
fi

echo "✅ Evidence assertions passed: $ROOT"
