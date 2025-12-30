/**
 * Load vendored runtime-matrix.yml
 * Used by build config validation and workflow defaults.
 *
 * No network calls; deterministic input.
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const MATRIX_PATH = path.join(ROOT, "internal", "vendor", "runtime-matrix.yml");

export function loadRuntimeMatrix() {
  if (!fs.existsSync(MATRIX_PATH)) {
    throw new Error(`runtime matrix not found: ${MATRIX_PATH}`);
  }
  const parsed = yaml.load(fs.readFileSync(MATRIX_PATH, "utf-8"));
  return parsed;
}
