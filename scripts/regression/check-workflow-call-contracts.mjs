/**
 * Check that reusable workflows keep stable workflow_call input contracts.
 *
 * What this enforces:
 * - workflow has `on.workflow_call`
 * - workflow_call.inputs has declared types
 * - no "breaking rename" occurs without deliberate review
 *
 * Design:
 * - A JSON snapshot file (contract snapshot) acts as the "lockfile" for inputs.
 * - If new inputs are added: allowed (non-breaking)
 * - If inputs removed/renamed/type-changed: fail
 *
 * Update policy:
 * - When intentionally changing the contract, update the snapshot in same PR.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const workflowsDir = process.env.WORKFLOWS_DIR || ".github/workflows";
const snapshotPath = "scripts/regression/workflow-contract.snapshot.json";

function fail(msg) {
  console.error(`❌ workflow-call-contracts: ${msg}`);
  process.exit(1);
}

function listYml(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) continue;
    if (f.endsWith(".yml") || f.endsWith(".yaml")) out.push(p);
  }
  return out;
}

function extractContract(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = YAML.parse(raw);
  const wfCall = doc?.on?.workflow_call;
  if (!wfCall) return null;

  const inputs = wfCall.inputs || {};
  const normalized = {};
  for (const [name, v] of Object.entries(inputs)) {
    normalized[name] = {
      required: Boolean(v?.required ?? false),
      type: String(v?.type || ""),
      default: v?.default ?? null,
      description: String(v?.description || ""),
    };
    if (!normalized[name].type) fail(`Input "${name}" missing type in ${filePath}`);
  }
  return normalized;
}

if (!fs.existsSync(workflowsDir)) fail(`WORKFLOWS_DIR not found: ${workflowsDir}`);

const workflowFiles = listYml(workflowsDir);
const current = {};

for (const wf of workflowFiles) {
  const c = extractContract(wf);
  if (c) current[path.basename(wf)] = c;
}

if (Object.keys(current).length === 0) {
  console.log("ℹ️ No reusable workflows (workflow_call) found. Skipping contract checks.");
  process.exit(0);
}

let snapshot = {};
if (fs.existsSync(snapshotPath)) {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
} else {
  // First run bootstrap: write snapshot and pass (intentional).
  fs.writeFileSync(snapshotPath, JSON.stringify(current, null, 2));
  console.log(`✅ workflow-call-contracts: snapshot created at ${snapshotPath}`);
  process.exit(0);
}

// Compare: removed/renamed/type-change is breaking
for (const [wfName, snapInputs] of Object.entries(snapshot)) {
  if (!current[wfName]) continue; // allow removing an entire workflow only if PR deletes it (handled by reviewers)
  const curInputs = current[wfName];

  for (const [inputName, snapDef] of Object.entries(snapInputs)) {
    if (!curInputs[inputName]) {
      fail(`Breaking change: input removed "${wfName}::${inputName}"`);
    }
    if (curInputs[inputName].type !== snapDef.type) {
      fail(
        `Breaking change: input type changed "${wfName}::${inputName}" ` +
          `(${snapDef.type} -> ${curInputs[inputName].type})`
      );
    }
  }
}

console.log(`✅ workflow-call-contracts: OK (${Object.keys(current).length} workflow(s) checked)`);
