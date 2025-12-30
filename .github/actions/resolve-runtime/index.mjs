/**
 * Resolve Runtime Defaults (BrikByteOS Pipelines)
 *
 * Reads the vendored runtime-matrix.yml and resolves:
 *  - default runtime version (unless override provided)
 *  - support status (supported/experimental/planned)
 *  - default toolchain (package manager + build tool)
 *
 * This makes reusable workflows deterministic and keeps policy in one place.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";

const MATRIX_PATH = path.join(process.cwd(), "internal", "vendor", "runtime-matrix.yml");

function fail(msg) {
  console.error(`❌ resolve-runtime: ${msg}`);
  process.exit(1);
}

function setOutput(name, value) {
  // GitHub Actions output contract
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function main() {
  if (!fs.existsSync(MATRIX_PATH)) fail(`runtime matrix missing at ${MATRIX_PATH}`);

  const matrix = yaml.load(fs.readFileSync(MATRIX_PATH, "utf-8"));
  const runtimeName = process.env.INPUT_RUNTIME_NAME;
  const overrideVersion = (process.env.INPUT_RUNTIME_VERSION || "").trim();

  const stack = (matrix.stacks || []).find((s) => s?.runtime?.name === runtimeName);
  if (!stack) fail(`runtime "${runtimeName}" not found in matrix`);

  const resolvedVersion = overrideVersion || stack.defaultVersion;
  if (!resolvedVersion) fail(`no defaultVersion and no override provided for "${runtimeName}"`);

  setOutput("runtime_version", resolvedVersion);
  setOutput("support_status", stack.supportStatus || "supported");

  setOutput("package_manager_default", stack?.toolchain?.packageManagers?.default || "");
  setOutput("build_tool_default", stack?.toolchain?.buildTools?.default || "");

  console.log(`✅ resolve-runtime: ${runtimeName} -> ${resolvedVersion} (${stack.supportStatus})`);
}

main();
