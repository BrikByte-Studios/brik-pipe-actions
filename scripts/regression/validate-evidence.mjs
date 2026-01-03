/**
 * CLI helper to validate evidence JSON against a schema using AJV.
 *
 * Usage:
 *   node scripts/regression/validate-evidence.mjs --schema <schema.json> --file <metadata.json>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return process.argv[idx + 1] || "";
}

const schemaPath = arg("--schema");
const filePath = arg("--file");

if (!schemaPath || !filePath) {
  console.error("Usage: --schema <path> --file <path>");
  process.exit(2);
}

const schema = JSON.parse(fs.readFileSync(path.resolve(schemaPath), "utf8"));
const data = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const ok = validate(data);

if (!ok) {
  console.error("❌ evidence validation failed:");
  console.error(validate.errors);
  process.exit(1);
}

console.log("✅ evidence validation OK");
