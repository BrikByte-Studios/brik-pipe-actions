/**
 * BrikByteOS Governance Gate — Workflow Stage Order (v1)
 *
 * Enforces canonical stage sequence:
 *   Install → Lint? → Test? → Build → Evidence(always) → Verdict(always)
 *
 * HARD LAW:
 *  - Evidence MUST exist and MUST run with if: always()
 *  - Verdict MUST exist and MUST run with if: always()
 *  - Stages may be skipped but MUST NOT be reordered
 */

import fs from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = path.join(process.cwd(), ".github", "workflows");

const EXPECTED_ORDER = ["install", "lint", "test", "buildstep", "evidence", "verdict"];

const STEP_ALIASES = {
  install: new Set(["install"]),
  lint: new Set(["lint"]),
  test: new Set(["test"]),
  buildstep: new Set(["buildstep", "build"]),
  evidence: new Set(["evidence"]),
  verdict: new Set(["verdict"]),
};

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/\t/g, "  ");
}

/**
 * Extract step blocks under `steps:` with their raw lines + discovered id.
 * Zero YAML deps. Indentation-based.
 */
function extractStepBlocks(yamlText) {
  const lines = yamlText.split("\n").map((l) => l.replace(/\t/g, "  "));
  let inSteps = false;
  let stepsIndent = -1;

  const blocks = [];
  let current = null;

  // Helper to get indentation
  const indentOf = (line) => line.length - line.trimStart().length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // Enter steps:
    if (!inSteps && t === "steps:") {
      inSteps = true;
      stepsIndent = indentOf(line);
      continue;
    }

    if (!inSteps) continue;

    // Leave steps: when indentation returns to <= stepsIndent (and not the steps: line itself)
    if (indentOf(line) <= stepsIndent && t !== "steps:") {
      // flush last block
      if (current) blocks.push(current);
      inSteps = false;
      current = null;
      continue;
    }

    // A step starts with "- " at indentation > stepsIndent
    const isStepStart =
      t.startsWith("- ") && indentOf(line) > stepsIndent;

    if (isStepStart) {
      if (current) blocks.push(current);
      current = { lines: [line], id: null };
      continue;
    }

    // Accumulate lines into current step block
    if (current) {
      current.lines.push(line);

      // Capture id: <value> (allow spaces)
      const m = t.match(/^id:\s*([A-Za-z0-9_-]+)\s*$/);
      if (m) current.id = m[1];
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function extractStepIds(yamlText) {
  return extractStepBlocks(yamlText)
    .map((b) => b.id)
    .filter(Boolean);
}

function findIndex(ids, role) {
  for (let i = 0; i < ids.length; i++) {
    if (STEP_ALIASES[role].has(ids[i])) return i;
  }
  return -1;
}

/**
 * Checks if the step with id=<stepId> has an if: that includes always().
 * Accepts:
 *   if: always()
 *   if: ${{ always() }}
 *   if: ${{ something && always() }}
 */
function stepHasAlwaysGuard(yamlText, stepId) {
  const blocks = extractStepBlocks(yamlText);
  const block = blocks.find((b) => b.id === stepId);
  if (!block) return false;

  return block.lines.some((l) => {
    const t = l.trim();
    return t.startsWith("if:") && t.includes("always()");
  });
}

let failed = false;

for (const wf of fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => f.startsWith("build-") && (f.endsWith(".yml") || f.endsWith(".yaml")))) {
  const yamlText = read(path.join(WORKFLOW_DIR, wf));
  const ids = extractStepIds(yamlText);

  let wfFailed = false;

  // Evidence step must exist and be always()
  if (findIndex(ids, "evidence") === -1 || !stepHasAlwaysGuard(yamlText, "evidence")) {
    console.error(`❌ ${wf}: missing or non-always() evidence step`);
    wfFailed = true;
  }

  // Verdict step must exist and be always()
  if (findIndex(ids, "verdict") === -1 || !stepHasAlwaysGuard(yamlText, "verdict")) {
    console.error(`❌ ${wf}: missing or non-always() verdict step`);
    wfFailed = true;
  }

  // Stage order (relative order of stages that exist)
  let last = -1;
  for (const stage of EXPECTED_ORDER) {
    const i = findIndex(ids, stage);
    if (i !== -1 && i < last) {
      console.error(`❌ ${wf}: stage order violation (${ids.join(" → ")})`);
      wfFailed = true;
      break;
    }
    if (i !== -1) last = i;
  }

  if (!wfFailed) console.log(`✅ ${wf}: stage order OK`);
  else failed = true;
}

if (failed) process.exit(1);
console.log("✅ All workflows comply with v1 stage order contract");

