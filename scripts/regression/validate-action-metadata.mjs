/**
 * Validate action metadata files for basic sanity.
 *
 * What this catches:
 * - missing action.yml
 * - missing required keys: name, runs.using
 * - unsupported runs.using values
 * - composite actions missing runs.steps
 *
 * Lightweight by design (<1 min).
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const actionsDir = process.env.ACTIONS_DIR || ".github/actions";

function walkDirs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(p, ...walkDirs(p));
  }
  return out;
}

function safeParseYaml(raw, filePath) {
  try {
    return YAML.parse(raw);
  } catch (e) {
    return { __parseError: `YAML parse error: ${e?.message || String(e)}`, __filePath: filePath };
  }
}

const errors = [];
const okUsing = new Set(["composite", "node20", "node18", "node16"]);

console.log(`🔎 validate-action-metadata: scanning "${actionsDir}"`);

if (!fs.existsSync(actionsDir)) {
  console.error(`❌ validate-action-metadata: ACTIONS_DIR not found: ${actionsDir}`);
  process.exit(1);
}

const actionDirs = walkDirs(actionsDir).filter((d) => fs.existsSync(path.join(d, "action.yml")));
if (actionDirs.length === 0) {
  console.error(`❌ validate-action-metadata: No action.yml files found under ${actionsDir}`);
  process.exit(1);
}

for (const dir of actionDirs) {
  const ymlPath = path.join(dir, "action.yml");
  const raw = fs.readFileSync(ymlPath, "utf8");
  const obj = safeParseYaml(raw, ymlPath);

  if (obj?.__parseError) {
    errors.push({ path: ymlPath, reason: obj.__parseError });
    continue;
  }

  if (!obj?.name) errors.push({ path: ymlPath, reason: `Missing "name"` });
  if (!obj?.runs?.using) errors.push({ path: ymlPath, reason: `Missing "runs.using"` });

  const using = String(obj?.runs?.using || "");
  if (using && !okUsing.has(using)) {
    errors.push({ path: ymlPath, reason: `Unexpected runs.using="${using}" (allowed: ${[...okUsing].join(", ")})` });
  }

  if (using === "composite") {
    if (!Array.isArray(obj?.runs?.steps) || obj.runs.steps.length === 0) {
      errors.push({ path: ymlPath, reason: `Composite action must define non-empty "runs.steps"` });
    }
  }
}

if (errors.length === 0) {
  console.log(`✅ validate-action-metadata: PASS (${actionDirs.length} actions checked)`);
  process.exit(0);
}

console.error(`❌ validate-action-metadata: FAIL (${errors.length} issues across ${actionDirs.length} actions)`);
for (const e of errors) console.error(`- ${e.path}: ${e.reason}`);
process.exit(1);
