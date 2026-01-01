/**
 * Validate composite action metadata files for basic sanity.
 *
 * What this catches:
 * - missing action.yml
 * - missing required keys: name, runs.using, runs.steps
 * - wrong 'using' field (must be "composite" for composite actions)
 *
 * This is intentionally lightweight to keep checks fast (<1 min).
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const actionsDir = process.env.ACTIONS_DIR || ".github/actions";

function fail(msg) {
  console.error(`❌ validate-action-metadata: ${msg}`);
  process.exit(1);
}

function walkDirs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(p, ...walkDirs(p));
  }
  return out;
}

if (!fs.existsSync(actionsDir)) fail(`ACTIONS_DIR not found: ${actionsDir}`);

const actionDirs = walkDirs(actionsDir).filter((d) => fs.existsSync(path.join(d, "action.yml")));
if (actionDirs.length === 0) fail(`No action.yml files found under ${actionsDir}`);

for (const dir of actionDirs) {
  const ymlPath = path.join(dir, "action.yml");
  const raw = fs.readFileSync(ymlPath, "utf8");
  const obj = YAML.parse(raw);

  if (!obj?.name) fail(`Missing "name" in ${ymlPath}`);
  if (!obj?.runs?.using) fail(`Missing "runs.using" in ${ymlPath}`);

  // Most BrikByte actions here are composite or node20. Accept either.
  const using = String(obj.runs.using);
  const okUsing = new Set(["composite", "node20", "node16", "node18"]);
  if (!okUsing.has(using)) fail(`Unexpected runs.using="${using}" in ${ymlPath}`);

  if (using === "composite") {
    if (!Array.isArray(obj?.runs?.steps) || obj.runs.steps.length === 0) {
      fail(`Composite action must define runs.steps in ${ymlPath}`);
    }
  }
}

console.log(`✅ validate-action-metadata: OK (${actionDirs.length} actions checked)`);
