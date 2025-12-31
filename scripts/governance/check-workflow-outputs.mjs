/**
 * BrikByteOS Governance Gate — Workflow Outputs (v1)
 *
 * Enforces presence of canonical reusable-workflow outputs:
 *   build_verdict, runtime_used, audit_bundle_path
 */

import fs from "node:fs";
import path from "node:path";

const WORKFLOW_DIR = path.join(process.cwd(), ".github", "workflows");

const REQUIRED_OUTPUTS = ["build_verdict", "runtime_used", "audit_bundle_path"];

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function hasOutput(yaml, key) {
  return new RegExp(`outputs:[\\s\\S]*?\\n\\s+${key}:`).test(yaml);
}

let failed = false;

for (const wf of fs.readdirSync(WORKFLOW_DIR).filter(f => f.startsWith("build-"))) {
  const yaml = read(path.join(WORKFLOW_DIR, wf));
  for (const key of REQUIRED_OUTPUTS) {
    if (!hasOutput(yaml, key)) {
      console.error(`❌ ${wf}: missing required output "${key}"`);
      failed = true;
    }
  }
  if (!failed) console.log(`✅ ${wf}: outputs OK`);
}

if (failed) process.exit(1);
console.log("✅ All workflows expose canonical outputs");
