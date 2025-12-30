import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ALLOWED_COMMON = new Set([
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

const ALLOWED_STACK_EXTRA = {
  "build-node.yml": new Set(["package_manager"]),
  "build-python.yml": new Set(["package_manager"]),
  "build-java.yml": new Set(["build_tool"]),
  "build-dotnet.yml": new Set([]),
  "build-go.yml": new Set([]),
};

function fail(msg) {
  console.error(`❌ workflow input contract: ${msg}`);
  process.exit(1);
}

const wfDir = path.join(process.cwd(), ".github", "workflows");
const workflows = Object.keys(ALLOWED_STACK_EXTRA);

for (const file of workflows) {
  const p = path.join(wfDir, file);
  const doc = yaml.load(fs.readFileSync(p, "utf-8"));
  const inputs = doc?.on?.workflow_call?.inputs || {};

  const extras = ALLOWED_STACK_EXTRA[file];
  for (const inputName of Object.keys(inputs)) {
    const ok = ALLOWED_COMMON.has(inputName) || extras.has(inputName);
    if (!ok) fail(`${file} has non-v1 input "${inputName}"`);
  }
}

console.log("✅ workflow input contract OK (v1 minimal inputs only)");
