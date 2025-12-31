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
    if (inSteps && (line.length - line.trimStart().length) <= indent && t !== "steps:") inSteps = false;
    if (!inSteps) continue;

    const m = t.match(/^id:\s*([A-Za-z0-9_-]+)$/);
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

function assertAlways(yaml, id) {
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `id: ${id}`) {
      for (let j = i; j < i + 14 && j < lines.length; j++) {
        if (lines[j].trim() === "if: always()") return true;
      }
      return false;
    }
  }
  return false;
}

let failed = false;

for (const wf of fs.readdirSync(WORKFLOW_DIR).filter(f => f.startsWith("build-"))) {
  const yaml = read(path.join(WORKFLOW_DIR, wf));
  const ids = extractStepIds(yaml);

  if (findIndex(ids, "evidence") === -1 || !assertAlways(yaml, "evidence")) {
    console.error(`❌ ${wf}: missing or non-always() evidence step`);
    failed = true;
  }

  if (findIndex(ids, "verdict") === -1 || !assertAlways(yaml, "verdict")) {
    console.error(`❌ ${wf}: missing or non-always() verdict step`);
    failed = true;
  }

  let last = -1;
  for (const stage of EXPECTED_ORDER) {
    const i = findIndex(ids, stage);
    if (i !== -1 && i < last) {
      console.error(`❌ ${wf}: stage order violation (${ids.join(" → ")})`);
      failed = true;
      break;
    }
    if (i !== -1) last = i;
  }

  if (!failed) console.log(`✅ ${wf}: stage order OK`);
}

if (failed) process.exit(1);
console.log("✅ All workflows comply with v1 stage order contract");
