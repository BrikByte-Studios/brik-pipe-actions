/**
 * Generate a deterministic validation failure and verify the validator still
 * writes `.audit/PIPE-BUILD/validation/*` evidence.
 *
 * Strategy:
 * - create a temporary invalid build.yml (empty runtime.version, tool.kind)
 * - run validate-build-config with config_path pointing to that temp file
 * - copy the evidence output into `.audit/PIPE-BUILD/validation-fail/<stack>`
 *
 * NOTE:
 * We want to verify evidence exists *even when validator fails*.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const stack = process.env.STACK;
const exampleDir = process.env.EXAMPLE_DIR;
const actionPath = process.env.ACTION_PATH || ".github/actions/validate-build-config";

function fail(msg) {
  console.error(`❌ fail-validation: ${msg}`);
  process.exit(1);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

if (!stack) fail("STACK env missing");
if (!exampleDir) fail("EXAMPLE_DIR env missing");
if (!fs.existsSync(actionPath)) fail(`ACTION_PATH not found: ${actionPath}`);

const tmpDir = path.join(process.cwd(), "scripts/regression/.tmp", stack);
ensureDir(tmpDir);

const invalidPath = path.join(tmpDir, "build.invalid.yml");

// Intentionally invalid per schema: empty strings where minLength=1
const invalid = `schemaVersion: 1
stack: ${stack}
workingDirectory: "."
runtime:
  version: ""
tool:
  kind: ""
flags:
  runLint: false
  runTests: true
commands:
  install: "echo install"
  lint: "echo lint"
  test: "echo test"
  build: "echo build"
artifacts:
  paths: ["out/**"]
`;

fs.writeFileSync(invalidPath, invalid, "utf8");

// Prefer dist entry if present (bundled), otherwise run source build step if repo uses it.
const distEntry = path.join(actionPath, "dist", "index.js");
if (!fs.existsSync(distEntry)) {
  // If dist is missing in CI, this repo should add a build step to generate it.
  // For regression, we fail early to prevent silent “works in dev only”.
  fail(`Validator dist entry missing at ${distEntry}. Ensure action is bundled.`);
}

const env = {
  ...process.env,
  INPUT_CONFIG_PATH: invalidPath,
  INPUT_STRICT: "false",
  INPUT_ALLOW_UNSAFE_COMMANDS: "false",
  GITHUB_WORKSPACE: process.cwd(),
};

const res = spawnSync("node", [distEntry], { env, stdio: "inherit" });

// We EXPECT failure here
if (res.status === 0) {
  fail("Expected validator to fail but it exited 0");
}

// Copy evidence into a stack-scoped fail folder so checks can be deterministic
const srcEvidence = path.join(process.cwd(), ".audit/PIPE-BUILD/validation");
const dstEvidence = path.join(process.cwd(), `.audit/PIPE-BUILD/validation-fail/${stack}`);

if (!fs.existsSync(srcEvidence)) fail(`Expected evidence folder missing: ${srcEvidence}`);
ensureDir(dstEvidence);

// Shallow copy required evidence files
for (const f of ["validation-report.json", "validation-summary.md", "build-config.raw.yml"]) {
  const src = path.join(srcEvidence, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dstEvidence, f));
}

console.log(`✅ fail-validation: OK (${stack}) evidence at ${dstEvidence}`);
