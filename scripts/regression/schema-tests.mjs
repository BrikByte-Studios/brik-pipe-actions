/**
 * Schema validation regression tests for `.brik/build.yml`.
 *
 * Goals:
 * - validate JSON schema catches missing fields / invalid enums / invalid types
 * - validate min-length behaviors (no empty strings for required fields)
 * - keep tests deterministic and fast
 *
 * NOTE:
 * This tests the schema file itself (`schemas/build.schema.json`) as a product artifact.
 * The validator action may have additional rule checks; those are covered by smoke-runner.
 */
import fs from "node:fs";
import Ajv from "ajv";

const schemaPath = process.env.SCHEMA_PATH || "schemas/build.schema.json";

function fail(msg) {
  console.error(`❌ schema-tests: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) fail(`Schema not found: ${schemaPath}`);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const validate = ajv.compile(schema);

function assertValid(name, obj) {
  const ok = validate(obj);
  if (!ok) {
    console.error(validate.errors);
    fail(`Expected VALID but got INVALID: ${name}`);
  }
}

function assertInvalid(name, obj) {
  const ok = validate(obj);
  if (ok) fail(`Expected INVALID but got VALID: ${name}`);
}

const baseNode = {
  schemaVersion: 1,
  stack: "node",
  workingDirectory: ".",
  runtime: { version: "20" },
  tool: { kind: "npm" },
  flags: { runLint: true, runTests: true },
  commands: {
    install: "make install",
    lint: "make lint",
    test: "make test",
    build: "make build",
  },
  artifacts: { paths: ["dist/**"] },
};

assertValid("node valid", baseNode);

assertInvalid("missing schemaVersion", { ...baseNode, schemaVersion: undefined });
assertInvalid("invalid stack", { ...baseNode, stack: "ruby" });
assertInvalid("empty runtime.version", { ...baseNode, runtime: { version: "" } });
assertInvalid("empty tool.kind", { ...baseNode, tool: { kind: "" } });
assertInvalid("install empty", { ...baseNode, commands: { ...baseNode.commands, install: "" } });
assertInvalid("build empty", { ...baseNode, commands: { ...baseNode.commands, build: "" } });
assertInvalid("commands wrong type", { ...baseNode, commands: "make ci" });

console.log("✅ schema-tests: OK");
