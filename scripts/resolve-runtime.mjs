/**
 * Returns canonical defaults for a runtime stack.
 * Used by reusable workflows + validators.
 */

import yaml from "js-yaml";
import fs from "node:fs";

const matrix = yaml.load(
  fs.readFileSync("governance/runtime-matrix.yml", "utf8")
);

export function resolveRuntime(runtimeName) {
  const stack = matrix.stacks.find(s => s.runtime.name === runtimeName);
  if (!stack) throw new Error(`Unsupported runtime: ${runtimeName}`);
  return stack;
}
