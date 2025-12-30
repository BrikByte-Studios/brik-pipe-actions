import * as core from "@actions/core";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

type RuntimeName = "node" | "python" | "java" | "dotnet" | "go";

function resolveActionDir(): string {
  /**
   * Preferred (sometimes present):
   *   GITHUB_ACTION_PATH => folder that contains action.yml
   *
   * Reliable fallback for JS actions:
   *   __dirname => .../.github/actions/resolve-runtime/dist
   *   so action dir is one level up from dist/
   */
  const envActionPath = process.env.GITHUB_ACTION_PATH;
  if (envActionPath && envActionPath.trim().length > 0) return envActionPath;

  // ncc bundles into dist/index.js; __dirname points at dist/
  return path.resolve(__dirname, "..");
}

function resolveActionRepoRoot(): string {
  /**
   * actionDir:
   *   .../.github/actions/resolve-runtime
   *
   * repoRoot is 3 levels up:
   *   resolve-runtime -> actions -> .github -> repo root
   */
  const actionDir = resolveActionDir();
  return path.resolve(actionDir, "../../..");
}

function loadMatrix(): any {
  const repoRoot = resolveActionRepoRoot();

  // Try both canonical locations (pick ONE and standardize later).
  const candidates = [
    path.join(repoRoot, "docs", "pipelines", "runtime-matrix.yml"),
    path.join(repoRoot, "internal", "vendor", "runtime-matrix.yml"),
  ];

  const matrixPath = candidates.find((p) => fs.existsSync(p));
  if (!matrixPath) {
    throw new Error(
      `runtime-matrix.yml not found.\nTried:\n- ${candidates.join("\n- ")}\n` +
        `Fix: ensure the matrix is committed in brik-pipe-actions at one of those paths.`
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

  const matrix = loadMatrix();
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
