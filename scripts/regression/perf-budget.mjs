/**
 * Perf budget test for validate-build-config action.
 *
 * Target: < 5 seconds
 *
 * Method:
 * - run the action's build/entry in a minimal way by executing its JS bundle
 *   (or via `node` runner on source if you prefer).
 *
 * This script is intentionally "soft" (budget + headroom) and should not
 * turn flaky on CI. If it gets close to 5s, that’s a signal the validator is
 * doing too much IO or unnecessary processing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const actionPath = process.env.ACTION_PATH || ".github/actions/validate-build-config";
const exampleConfig = process.env.EXAMPLE_CONFIG || "scripts/regression/fixtures/valid/node.build.yml";

function fail(msg) {
  console.error(`❌ perf-budget: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(actionPath)) fail(`ACTION_PATH not found: ${actionPath}`);
if (!fs.existsSync(exampleConfig)) fail(`EXAMPLE_CONFIG not found: ${exampleConfig}`);

// Expect dist/index.js once bundled; if not present, fall back to ncc build first.
const distEntry = `${actionPath}/dist/index.js`;

const t0 = Date.now();

let cmd, args;
if (fs.existsSync(distEntry)) {
  cmd = "node";
  args = [distEntry];
} else {
  // Fallback: run the action build script if present (repo-dependent).
  // You can also prebuild in CI to keep this stable.
  cmd = "node";
  args = ["scripts/build-validate-build-config.mjs"];
}

const res = spawnSync(cmd, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    INPUT_CONFIG_PATH: exampleConfig,
    INPUT_STRICT: "false",
    INPUT_ALLOW_UNSAFE_COMMANDS: "false",
    GITHUB_WORKSPACE: process.cwd(),
  },
});

if (res.status !== 0) fail(`Validator failed during perf run (exit ${res.status})`);

const ms = Date.now() - t0;
console.log(`⏱️ perf-budget: ${ms}ms`);

if (ms > 5000) fail(`Perf budget exceeded: ${ms}ms > 5000ms`);
console.log("✅ perf-budget: OK");
