/**
 * Validate evidence bundle structure + metadata.json against schema.
 *
 * Enforces governance safeguard:
 * - Evidence exists on success AND failure
 * - metadata.json includes required keys
 */
import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";

function fail(msg) {
  console.error(`❌ validate-evidence: ${msg}`);
  process.exit(1);
}

const root = process.env.EVIDENCE_ROOT;
if (!root) fail("EVIDENCE_ROOT env missing");

const metaPath = path.join(root, "metadata.json");
if (!fs.existsSync(metaPath)) fail(`metadata.json missing at ${metaPath}`);

const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));

const schemaPath = path.resolve("scripts/regression/schemas/metadata.schema.json");
if (!fs.existsSync(schemaPath)) fail(`metadata schema missing: ${schemaPath}`);

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

if (!validate(meta)) {
  console.error(validate.errors);
  fail(`metadata.json does not match schema: ${metaPath}`);
}

console.log(`✅ validate-evidence: OK (${root})`);
