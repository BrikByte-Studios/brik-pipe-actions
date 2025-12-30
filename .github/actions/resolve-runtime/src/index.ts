/**
 * BrikByteOS — resolve-runtime action
 *
 * Loads the vendored runtime matrix (docs/pipelines/runtime-matrix.yml) and resolves:
 * - runtime_version: caller override OR matrix defaultVersion
 * - support_status: supported|experimental|planned
 * - package_manager_default: toolchain.packageManagers.default (if present)
 * - build_tool_default: toolchain.buildTools.default (if present)
 *
 * This action must be dependency-bundled (via ncc) so it runs with zero installs in CI.
 */
import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type RuntimeName = "node" | "python" | "java" | "dotnet" | "go";

function loadMatrix(workspace: string): any {
  const matrixPath = path.join(workspace, "docs", "pipelines", "runtime-matrix.yml");
  if (!fs.existsSync(matrixPath)) {
    throw new Error(`runtime-matrix.yml not found at: ${matrixPath}`);
  }
  const raw = fs.readFileSync(matrixPath, "utf-8");
  return yaml.load(raw);
}

function findStack(matrix: any, runtimeName: RuntimeName): any {
  const stacks = matrix?.stacks ?? [];
  const stack = stacks.find((s: any) => s?.runtime?.name === runtimeName);
  if (!stack) throw new Error(`runtime "${runtimeName}" not found in matrix.stacks`);
  return stack;
}

function main() {
  const runtimeName = core.getInput("runtime_name", { required: true }) as RuntimeName;
  const override = (core.getInput("runtime_version") || "").trim();

  // GitHub sets GITHUB_WORKSPACE to the checked-out repo root.
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

  const matrix = loadMatrix(workspace);
  const stack = findStack(matrix, runtimeName);

  const runtimeVersion = override.length > 0 ? override : String(stack.defaultVersion || "");
  if (!runtimeVersion) throw new Error(`[${runtimeName}] could not resolve runtime_version (missing defaultVersion?)`);

  const supportStatus = String(stack.supportStatus || "supported");
  const pmDefault = String(stack?.toolchain?.packageManagers?.default || "");
  const btDefault = String(stack?.toolchain?.buildTools?.default || "");

  core.setOutput("runtime_version", runtimeVersion);
  core.setOutput("support_status", supportStatus);
  core.setOutput("package_manager_default", pmDefault);
  core.setOutput("build_tool_default", btDefault);
}

try {
  main();
} catch (err: any) {
  core.setFailed(err?.message ?? String(err));
}
