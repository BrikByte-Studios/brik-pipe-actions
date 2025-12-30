/**
 * Validate .brik/build.yml using runtime-matrix.yml as the allowlist.
 *
 * Enforces:
 * - runtime is supported (node/python/java/dotnet/go)
 * - version aligns with matrix supportedVersions
 * - tool selections are allowed (package manager/build tool)
 * - (future) overrides only allowed when exceptions enabled + approved
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { loadRuntimeMatrix } from "../runtime-matrix/load-runtime-matrix.mjs";

const BUILD_CONFIG_PATH = path.join(process.cwd(), ".brik", "build.yml");

function readBuildConfig() {
  if (!fs.existsSync(BUILD_CONFIG_PATH)) {
    throw new Error(`.brik/build.yml not found at ${BUILD_CONFIG_PATH}`);
  }
  return yaml.load(fs.readFileSync(BUILD_CONFIG_PATH, "utf-8"));
}

function findStack(matrix, runtimeName) {
  return (matrix.stacks ?? []).find((s) => s?.runtime?.name === runtimeName);
}

function versionCompatible(requested, supportedList) {
  if (!requested) return false;
  const prefix = requested.replace(/\.x$/, "");
  return supportedList.some((v) => v === requested || (prefix && v.startsWith(prefix)));
}

export function validateBuildConfig() {
  const matrix = loadRuntimeMatrix();
  const cfg = readBuildConfig();

  const errors = [];

  // Example build.yml shape:
  // runtime:
  //   name: node
  //   version: 20.x
  // toolchain:
  //   packageManager: pnpm
  //   buildTool: pnpm
  const runtimeName = cfg?.runtime?.name;
  const runtimeVersion = cfg?.runtime?.version;

  if (!runtimeName) errors.push(`runtime.name is required`);
  const stack = findStack(matrix, runtimeName);

  if (!stack) {
    errors.push(`runtime.name "${runtimeName}" is not supported by runtime-matrix`);
  } else {
    const supported = stack?.supportedVersions?.versions ?? [];
    if (runtimeVersion && !versionCompatible(runtimeVersion, supported)) {
      errors.push(
        `[${runtimeName}] runtime.version "${runtimeVersion}" not compatible with supportedVersions: ${supported.join(", ")}`
      );
    }

    const pm = cfg?.toolchain?.packageManager ?? stack?.toolchain?.packageManagers?.default;
    const bt = cfg?.toolchain?.buildTool ?? stack?.toolchain?.buildTools?.default;

    const pmAllowed = stack?.toolchain?.packageManagers?.allowed ?? [];
    const btAllowed = stack?.toolchain?.buildTools?.allowed ?? [];

    if (pm && !pmAllowed.includes(pm)) {
      errors.push(`[${runtimeName}] toolchain.packageManager "${pm}" not allowed. Allowed: ${pmAllowed.join(", ")}`);
    }
    if (bt && !btAllowed.includes(bt)) {
      errors.push(`[${runtimeName}] toolchain.buildTool "${bt}" not allowed. Allowed: ${btAllowed.join(", ")}`);
    }

    // Optional enforcement: planned stacks cannot be used
    if (stack.supportStatus === "planned") {
      errors.push(`[${runtimeName}] runtime is "planned" and cannot be used yet`);
    }
  }

  return { ok: errors.length === 0, errors };
}
