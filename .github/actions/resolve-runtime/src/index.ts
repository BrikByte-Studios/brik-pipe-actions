/**
 * BrikByteOS — resolve-runtime action
 *
 * Loads the canonical runtime matrix (inside brik-pipe-actions) and resolves:
 * - runtime_version: caller override OR matrix defaultVersion
 * - support_status: supported|experimental|planned
 * - package_manager_default: toolchain.packageManagers.default (if present)
 * - build_tool_default: toolchain.buildTools.default (if present)
 *
 * Critical detail:
 *   We MUST NOT use GITHUB_WORKSPACE for reading the matrix, because
 *   GITHUB_WORKSPACE points to the *caller repo* workspace (e.g. brik-pipe-examples).
 *
 * Instead:
 *   Use GITHUB_ACTION_PATH (this action’s directory), walk up to the action repo root,
 *   then read docs/pipelines/runtime-matrix.yml from *brik-pipe-actions*.
 *
 * Bundling:
 *   This action must be dependency-bundled (via ncc) so it runs with zero installs in CI.
 */

import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type RuntimeName = "node" | "python" | "java" | "dotnet" | "go";

function resolveActionRepoRoot(): string {
  /**
   * GITHUB_ACTION_PATH points to the folder containing action.yml, e.g.:
   *   .../_actions/BrikByte-Studios/brik-pipe-actions/main/.github/actions/resolve-runtime
   *
   * Repo root is 3 levels up:
   *   resolve-runtime -> actions -> .github -> repo root
   */
  const actionPath = process.env.GITHUB_ACTION_PATH;
  if (!actionPath) throw new Error("GITHUB_ACTION_PATH is not set (expected in GitHub Actions runtime).");
  return path.resolve(actionPath, "../../..");
}

function loadMatrixFromActionRepo(): any {
  const repoRoot = resolveActionRepoRoot();
  const matrixPath = path.join(repoRoot, "docs", "pipelines", "runtime-matrix.yml");

  if (!fs.existsSync(matrixPath)) {
    throw new Error(
      `runtime-matrix.yml not found at: ${matrixPath}\n` +
        `Fix: ensure brik-pipe-actions contains docs/pipelines/runtime-matrix.yml at that path.`
    );
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

  const matrix = loadMatrixFromActionRepo();
  const stack = findStack(matrix, runtimeName);

  const runtimeVersion = override.length > 0 ? override : String(stack.defaultVersion || "");
  if (!runtimeVersion) throw new Error(`[${runtimeName}] could not resolve runtime_version (missing defaultVersion?)`);

  core.setOutput("runtime_version", runtimeVersion);
  core.setOutput("support_status", String(stack.supportStatus || "supported"));
  core.setOutput("package_manager_default", String(stack?.toolchain?.packageManagers?.default || ""));
  core.setOutput("build_tool_default", String(stack?.toolchain?.buildTools?.default || ""));
}

try {
  main();
} catch (err: any) {
  core.setFailed(err?.message ?? String(err));
}
