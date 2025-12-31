/**
 * BrikByteOS Governance Gate — Workflow Input Contract (v1)
 *
 * Purpose
 *   Enforce that every reusable build workflow (`.github/workflows/build-*.yml`)
 *   exposes the canonical v1 `workflow_call.inputs` contract.
 *
 * Guarantees
 *   - Missing required inputs fail CI (prevents accidental breaking changes)
 *   - Extra inputs fail CI (prevents ungoverned expansion / drift)
 *   - Zero dependencies (no YAML parser needed)
 *   - Deterministic and hermetic (filesystem only)
 *
 * Notes
 *   - This gate is intentionally conservative: it treats the YAML as text and
 *     only trusts indentation + known section boundaries.
 *   - If indentation is broken (YAML invalid), the gate should fail loudly.
 */

import fs from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = path.join(process.cwd(), ".github", "workflows");

// Canonical v1 contract (shared across stacks)
const REQUIRED_INPUTS = new Set([
  "working_directory",
  "runtime_version",
  "run_lint",
  "run_tests",
  "lint_command",
  "test_command",
  "build_command",
  "upload_artifacts",
  "artifact_paths",
]);

/**
 * Allowlisted additional inputs per workflow.
 * Use this ONLY when a stack genuinely requires extra input (e.g. java build_tool).
 * If you add something here, treat it as a governance change and update ADR/contract.
 *
 * NOTE:
 * - Do NOT repeat required inputs here. It’s harmless, but noisy.
 */
const ALLOWED_EXTRAS_BY_WORKFLOW = {
  "build-java.yml": new Set(["build_tool"]),
  "build-node.yml": new Set(["package_manager"]),
  "build-python.yml": new Set(["package_manager"]),
  "build-dotnet.yml": new Set([]),
  "build-go.yml": new Set([]),
};

/**
 * Reads file as UTF-8.
 */
function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Strict zero-deps scanner:
 *  - Find `on:` block
 *  - Find `workflow_call:` within `on:`
 *  - Find `inputs:` within `workflow_call:`
 *  - Determine direct child indentation under `inputs:`
 *  - Collect only keys at that indentation (avoid nested `type:`, `default:` etc.)
 *
 * Returns:
 *   { ok: true, inputs: string[] }
 *   { ok: false, inputs: [], error: string }
 */
function extractWorkflowCallInputsStrict(yamlText) {
  const lines = yamlText.split("\n").map((l) => l.replace(/\t/g, "  ")); // normalize tabs -> spaces

  // ---- 1) Find `on:` --------------------------------------------------------
  let onLineIndex = -1;
  let onIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "on:") {
      onLineIndex = i;
      onIndent = lines[i].length - lines[i].trimStart().length;
      break;
    }
  }

  if (onLineIndex === -1) {
    return { ok: false, inputs: [], error: "`on:` not found" };
  }

  // ---- 2) Find `workflow_call:` inside the `on:` block ----------------------
  let workflowCallLineIndex = -1;
  let workflowCallIndent = -1;

  for (let i = onLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // left the `on:` block
    if (indent <= onIndent) break;

    if (trimmed === "workflow_call:") {
      workflowCallLineIndex = i;
      workflowCallIndent = indent;
      break;
    }
  }

  if (workflowCallLineIndex === -1) {
    return { ok: false, inputs: [], error: "`workflow_call:` not found under `on:`" };
  }

  // ---- 3) Find `inputs:` inside the `workflow_call:` block ------------------
  let inputsLineIndex = -1;
  let inputsIndent = -1;

  for (let i = workflowCallLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // left `workflow_call:` block
    if (indent <= workflowCallIndent) break;

    if (trimmed === "inputs:") {
      inputsLineIndex = i;
      inputsIndent = indent;
      break;
    }
  }

  if (inputsLineIndex === -1) {
    return { ok: false, inputs: [], error: "`workflow_call.inputs` not found" };
  }

  // ---- 4) Determine indent of direct children under inputs ------------------
  let directChildIndent = null;

  for (let i = inputsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // left `inputs:` block
    if (indent <= inputsIndent) break;

    // first key under inputs establishes the direct-child indentation
    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):/);
    if (keyMatch) {
      directChildIndent = indent;
      break;
    }
  }

  if (directChildIndent == null) {
    return { ok: false, inputs: [], error: "inputs block found but contains no keys" };
  }

  // ---- 5) Collect only keys at directChildIndent ----------------------------
  const inputs = [];

  for (let i = inputsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // left `inputs:` block
    if (indent <= inputsIndent) break;

    // only accept direct children (prevents capturing nested `type:` etc.)
    if (indent === directChildIndent) {
      const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):/);
      if (keyMatch) inputs.push(keyMatch[1]);
    }
  }

  return { ok: true, inputs };
}

/**
 * Ensures:
 *  - all REQUIRED_INPUTS exist
 *  - no extra inputs exist unless allowlisted for that workflow
 */
function validateWorkflowInputs(workflowFileName, inputs) {
  const missing = [];
  for (const req of REQUIRED_INPUTS) {
    if (!inputs.includes(req)) missing.push(req);
  }

  const allowedExtras = ALLOWED_EXTRAS_BY_WORKFLOW[workflowFileName] || new Set();
  const extras = inputs.filter((k) => !REQUIRED_INPUTS.has(k) && !allowedExtras.has(k));

  return { missing, extras, allowedExtras: Array.from(allowedExtras) };
}

function main() {
  if (!fs.existsSync(WORKFLOW_DIR)) {
    console.error(`❌ WORKFLOW_DIR not found: ${WORKFLOW_DIR}`);
    process.exit(2);
  }

  const workflows = fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.startsWith("build-") && (f.endsWith(".yml") || f.endsWith(".yaml")));

  if (workflows.length === 0) {
    console.error("❌ No build-*.yml workflows found to validate");
    process.exit(2);
  }

  let failed = false;

  for (const wf of workflows) {
    const filePath = path.join(WORKFLOW_DIR, wf);
    const yamlText = read(filePath);

    const extracted = extractWorkflowCallInputsStrict(yamlText);
    if (!extracted.ok) {
      console.error(`❌ ${wf}: ${extracted.error}`);
      failed = true;
      continue;
    }

    const inputs = extracted.inputs;
    const { missing, extras, allowedExtras } = validateWorkflowInputs(wf, inputs);

    if (missing.length > 0) {
      console.error(`❌ ${wf} missing required inputs: ${missing.join(", ")}`);
      failed = true;
    }

    if (extras.length > 0) {
      console.error(
        `❌ ${wf} has unapproved extra inputs: ${extras.join(", ")} ` +
          `(allowed extras: ${allowedExtras.join(", ") || "none"})`
      );
      failed = true;
    }

    if (missing.length === 0 && extras.length === 0) {
      console.log(`✅ ${wf}: workflow_call.inputs contract OK (${inputs.length} inputs)`);
    }
  }

  if (failed) {
    console.error("❌ Workflow input contract violation (v1)");
    process.exit(1);
  }

  console.log("✅ All reusable build workflows comply with v1 input contract");
}

main();
