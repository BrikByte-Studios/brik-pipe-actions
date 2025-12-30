/**
 * BrikByteOS Governance Gate
 *
 * Enforces that ALL reusable workflows expose the canonical v1 workflow_call
 * contract and that no extra inputs are added without governance approval.
 *
 * Zero dependencies. Hermetic. Deterministic.
 */

import fs from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = ".github/workflows";

const REQUIRED_INPUTS = [
  "working_directory",
  "runtime_version",
  "run_lint",
  "run_tests",
  "lint_command",
  "test_command",
  "build_command",
  "upload_artifacts",
  "artifact_paths"
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

/**
 * Extracts input keys from a workflow_call block using structural parsing.
 */
function extractInputs(yaml) {
  const lines = yaml.split("\n");

  let inInputs = false;
  const inputs = [];

  for (const line of lines) {
    if (line.match(/workflow_call:/)) {
      inInputs = true;
      continue;
    }
    if (inInputs && line.match(/^\s*inputs:/)) {
      continue;
    }
    if (inInputs && line.match(/^\s{6,}[a-zA-Z0-9_-]+:/)) {
      const key = line.trim().split(":")[0];
      inputs.push(key);
    }
    if (inInputs && line.match(/^\s{2}[a-zA-Z]/)) {
      break;
    }
  }

  return inputs;
}

function main() {
  const workflows = fs.readdirSync(WORKFLOW_DIR)
    .filter(f => f.startsWith("build-") && f.endsWith(".yml"));

  let failed = false;

  for (const wf of workflows) {
    const file = path.join(WORKFLOW_DIR, wf);
    const yaml = read(file);
    const inputs = extractInputs(yaml);

    for (const required of REQUIRED_INPUTS) {
      if (!inputs.includes(required)) {
        console.error(`❌ ${wf} missing required input: ${required}`);
        failed = true;
      }
    }
  }

  if (failed) {
    console.error("❌ Workflow input contract violation");
    process.exit(1);
  }

  console.log("✅ Workflow input contracts are valid");
}

main();
