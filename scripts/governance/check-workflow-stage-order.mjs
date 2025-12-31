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

function extractStepIds(yaml) {
  const lines = yaml.split("\n");
  let inSteps = false;
  let indent = -1;
  const ids = [];

  for (const line of lines) {
    const t = line.trim();

    if (t === "steps:") {
      inSteps = true;
      indent = line.length - line.trimStart().length;
      continue;
    }

    if (inSteps && (line.length - line.trimStart().length) <= indent && t !== "steps:") {
      inSteps = false;
    }

    if (!inSteps) continue;

    const m = t.match(/^id:\s*([A-Za-z0-9_-]+)\s*$/);
    if (m) ids.push(m[1]);
  }

  return ids;
}

function findIndex(ids, role) {
  for (let i = 0; i < ids.length; i++) {
    if (STEP_ALIASES[role].has(ids[i])) return i;
  }
  return -1;
}

/**
 * Evidence/verdict MUST be guarded by always().
 *
 * Accept:
 *  - if: always()
 *  - if: ${{ always() }}
 *  - if: ${{ inputs.upload_artifacts && always() }}
 *  - if: ${{ always() && something }}
 *
 * Also handle if: appearing ABOVE or BELOW the id: line.
 */
function assertAlways(yaml, stepId) {
  const lines = yaml.split("\n").map((l) => l.replace(/\t/g, "  "));

  // Find the line where `id: <stepId>` appears
  let idLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `id: ${stepId}`) {
      idLine = i;
      break;
    }
  }
  if (idLine === -1) return false;

  const isAlwaysIf = (trimmedLine) =>
    trimmedLine.startsWith("if:") && trimmedLine.includes("always()");

  // Scan a window around id: to catch `if:` above or below.
  // Keep small to avoid false positives from other steps.
  const start = Math.max(0, idLine - 12);
  const end = Math.min(lines.length - 1, idLine + 18);

  for (let i = start; i <= end; i++) {
    const t = lines[i].trim();
    if (isAlwaysIf(t)) return true;
  }

  return false;
}

let failed = false;

for (const wf of fs.readdirSync(WORKFLOW_DIR).filter((f) => f.startsWith("build-") && (f.endsWith(".yml") || f.endsWith(".yaml")))) {
  const yaml = read(path.join(WORKFLOW_DIR, wf));
  const ids = extractStepIds(yaml);

  // Track per-workflow failures (so ✅ prints correctly per file)
  let wfFailed = false;

  // Evidence must exist and be always()
  if (findIndex(ids, "evidence") === -1 || !assertAlways(yaml, "evidence")) {
    console.error(`❌ ${wf}: missing or non-always() evidence step`);
    wfFailed = true;
  }

  // Verdict must exist and be always()
  if (findIndex(ids, "verdict") === -1 || !assertAlways(yaml, "verdict")) {
    console.error(`❌ ${wf}: missing or non-always() verdict step`);
    wfFailed = true;
  }

  // Stage order check (only relative order of stages that exist)
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

  if (!wfFailed) {
    console.log(`✅ ${wf}: stage order OK`);
  } else {
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✅ All workflows comply with v1 stage order contract");
