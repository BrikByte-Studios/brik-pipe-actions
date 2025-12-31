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
 */
const ALLOWED_EXTRAS_BY_WORKFLOW = {
  "build-java.yml": new Set(["build_tool", "artifact_paths"]), // artifact_paths already required; harmless if repeated
  "build-node.yml": new Set(["package_manager", "artifact_paths"]),
  "build-python.yml": new Set(["package_manager", "artifact_paths"]),
  "build-dotnet.yml": new Set(["artifact_paths"]),
  "build-go.yml": new Set(["artifact_paths"]),
};

/**
 * Reads file as UTF-8.
 */
function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Minimal structural YAML scanning to extract keys under:
 *   on:
 *     workflow_call:
 *       inputs:
 *         <key>:
 *
 * We do NOT parse YAML fully. We only:
 *   - Locate "workflow_call:" under "on:"
 *   - Locate "inputs:" under "workflow_call:"
 *   - Collect keys at the next indentation level
 *
 * Returns:
 *   { ok: boolean, inputs: string[], error?: string }
 */
function extractWorkflowCallInputs(yamlText) {
  const lines = yamlText.split("\n");

  // Track indentation-based state
  let inOn = false;
  let onIndent = null;

  let inWorkflowCall = false;
  let workflowCallIndent = null;

  let inInputs = false;
  let inputsIndent = null;

  const inputs = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\t/g, "  "); // normalize tabs -> spaces
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // Enter "on:" block
    if (!inOn && trimmed === "on:") {
      inOn = true;
      onIndent = indent;
      continue;
    }

    // If we were in "on:" but indentation returns to <= onIndent, we've left "on:"
    if (inOn && indent <= onIndent && trimmed !== "on:") {
      inOn = false;
      inWorkflowCall = false;
      inInputs = false;
    }

    // Enter "workflow_call:" under "on:"
    if (inOn && !inWorkflowCall && trimmed === "workflow_call:") {
      inWorkflowCall = true;
      workflowCallIndent = indent;
      continue;
    }

    // If we were in workflow_call but indentation returns to <= workflowCallIndent, we left it
    if (inWorkflowCall && indent <= workflowCallIndent && trimmed !== "workflow_call:") {
      inWorkflowCall = false;
      inInputs = false;
    }

    // Enter "inputs:" under workflow_call
    if (inWorkflowCall && !inInputs && trimmed === "inputs:") {
      inInputs = true;
      inputsIndent = indent;
      continue;
    }

    // If we are inside inputs, collect keys at the next indentation level.
    // Example:
    //   inputs:          (inputsIndent = 6)
    //     working_directory:   <-- key indent is inputsIndent + 2 (or more)
    if (inInputs) {
      // If indentation returns to <= inputsIndent, we've left inputs block.
      if (indent <= inputsIndent && trimmed !== "inputs:") {
        inInputs = false;
        continue;
      }

      // Match a YAML key definition: "<key>:"
      // Only accept keys that appear at indentation > inputsIndent (children),
      // and avoid capturing nested props like "type:" because those are deeper indented.
      const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*$/);
      if (keyMatch) {
        const keyIndent = indent;

        // Only accept keys that are direct children of inputs:
        // We accept the FIRST level under inputs. Nested keys will have larger indent.
        // We infer direct child level by taking the first key indent encountered.
        if (inputs.length === 0) {
          // First key sets the "direct child indent"
          // (common pattern is inputsIndent + 2, but we don't hardcode)
          inputs.push(keyMatch[1]);
          continue;
        }

        // Determine directChildIndent as indent of the first input key.
        const directChildIndent = (() => {
          // Find indent of first captured key by searching backwards for it in lines.
          // Simpler: we can store it once.
          return null;
        })();
      }
    }
  }

  // The above loop captured keys but didn't safely distinguish nested keys.
  // We'll do a second pass with a stricter extraction that sets directChildIndent.

  return extractWorkflowCallInputsStrict(yamlText);
}

/**
 * Strict version:
 *  - Identify workflow_call.inputs section
 *  - Determine the indentation of direct children under inputs
 *  - Only capture keys at that indentation level
 */
function extractWorkflowCallInputsStrict(yamlText) {
  const lines = yamlText.split("\n").map(l => l.replace(/\t/g, "  "));

  // Find the "inputs:" line that belongs to workflow_call
  let inputsLineIndex = -1;
  let inputsIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "inputs:") {
      // Quick heuristic: ensure we saw workflow_call above it before leaving that block
      // We'll scan upward a bit for "workflow_call:"
      let seenWorkflowCall = false;
      for (let j = i - 1; j >= 0 && j >= i - 25; j--) {
        const t = lines[j].trim();
        if (t === "workflow_call:") { seenWorkflowCall = true; break; }
        if (t === "on:") break;
      }
      if (seenWorkflowCall) {
        inputsLineIndex = i;
        inputsIndent = line.length - line.trimStart().length;
        break;
      }
    }
  }

  if (inputsLineIndex === -1) {
    return { ok: false, inputs: [], error: "workflow_call.inputs not found" };
  }

  // Determine indentation of direct children (first key after inputs:)
  let directChildIndent = null;
  for (let i = inputsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    // If indentation goes back to <= inputsIndent, inputs block ended
    if (indent <= inputsIndent) break;

    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(#.*)?$/);
    if (keyMatch) {
      directChildIndent = indent;
      break;
    }
  }

  if (directChildIndent == null) {
    return { ok: false, inputs: [], error: "inputs block found but contains no keys" };
  }

  // Collect only keys at directChildIndent
  const inputs = [];
  for (let i = inputsLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;

    if (indent <= inputsIndent) break; // left inputs section

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
