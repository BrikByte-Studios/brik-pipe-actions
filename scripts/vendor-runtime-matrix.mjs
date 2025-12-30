/**
 * Pulls canonical runtime-matrix.yml + schema from .github repo
 * Locks version and writes governance/runtime-matrix.*
 */

import { execSync } from "node:child_process";
import fs from "node:fs";

const SRC = "https://raw.githubusercontent.com/BrikByte-Studios/.github/main/docs/pipelines/runtime-matrix.yml";
const SCHEMA = "https://raw.githubusercontent.com/BrikByte-Studios/.github/main/schemas/runtime-matrix.schema.json";

execSync(`curl -sSL ${SRC} -o governance/runtime-matrix.yml`);
execSync(`curl -sSL ${SCHEMA} -o governance/runtime-matrix.schema.json`);

fs.writeFileSync("governance/runtime-matrix.version", ".github@main");
console.log("✓ Vendored canonical runtime matrix");
