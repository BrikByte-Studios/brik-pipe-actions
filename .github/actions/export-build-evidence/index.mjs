/**
 * Export Build Evidence (BrikByteOS Pipelines)
 *
 * Writes minimal, deterministic evidence under:
 *   .audit/PIPE-BUILD/
 *     metadata.json
 *     runtime.json
 *     commands.json
 *     results.json
 *     artifact-summary.json
 *     logs/(lint.log/test.log/build.log)
 *
 * Design goals:
 *  - Always runs (workflow uses if: always())
 *  - Works even when build/test/lint fail
 *  - No secrets; no network calls
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const OUT_DIR = path.join(process.cwd(), ".audit", "PIPE-BUILD");
const LOG_DIR = path.join(OUT_DIR, "logs");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readIfExists(p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf-8");
}

function jsonWrite(file, data) {
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(data, null, 2) + "\n");
}

function setOutput(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function isoNow() {
  return new Date().toISOString();
}

function main() {
  ensureDir(LOG_DIR);

  const stack = process.env.INPUT_STACK;
  const runtimeUsed = process.env.INPUT_RUNTIME_USED;
  const toolchain = process.env.INPUT_TOOLCHAIN;
  const wd = process.env.INPUT_WORKING_DIRECTORY || ".";

  const lintRan = process.env.INPUT_LINT_RAN === "true";
  const testRan = process.env.INPUT_TEST_RAN === "true";
  const buildRan = process.env.INPUT_BUILD_RAN === "true";

  const lintExit = process.env.INPUT_LINT_EXIT_CODE || "";
  const testExit = process.env.INPUT_TEST_EXIT_CODE || "";
  const buildExit = process.env.INPUT_BUILD_EXIT_CODE || "";

  const artifactPathsRaw = (process.env.INPUT_ARTIFACT_PATHS || "").trim();
  const artifactPaths = artifactPathsRaw
    ? artifactPathsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // GitHub context env vars
  const meta = {
    repo: process.env.GITHUB_REPOSITORY || null,
    sha: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
    run_id: process.env.GITHUB_RUN_ID || null,
    run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
    workflow: process.env.GITHUB_WORKFLOW || null,
    job: process.env.GITHUB_JOB || null,
    actor: process.env.GITHUB_ACTOR || null,
    startedAt: isoNow(),
    stack,
    toolchain,
    workingDirectory: wd,
  };

  jsonWrite("metadata.json", meta);

  jsonWrite("runtime.json", {
    stack,
    runtimeUsed,
    toolchain,
  });

  jsonWrite("commands.json", {
    lint: lintRan ? "ran" : "skipped",
    test: testRan ? "ran" : "skipped",
    build: buildRan ? "ran" : "skipped",
  });

  const verdict = {
    lint: lintRan ? (lintExit === "0" ? "pass" : "fail") : "skipped",
    test: testRan ? (testExit === "0" ? "pass" : "fail") : "skipped",
    build: buildRan ? (buildExit === "0" ? "pass" : "fail") : "skipped",
  };

  const overall =
    (buildRan && buildExit !== "0") ||
    (testRan && testExit !== "0") ||
    (lintRan && lintExit !== "0")
      ? "fail"
      : "pass";

  jsonWrite("results.json", {
    overall,
    exitCodes: {
      lint: lintExit || null,
      test: testExit || null,
      build: buildExit || null,
    },
    verdict,
  });

  // Copy logs into .audit even if empty
  const lintLog = readIfExists(process.env.INPUT_LINT_LOG);
  const testLog = readIfExists(process.env.INPUT_TEST_LOG);
  const buildLog = readIfExists(process.env.INPUT_BUILD_LOG);

  if (lintLog !== null) fs.writeFileSync(path.join(LOG_DIR, "lint.log"), lintLog);
  if (testLog !== null) fs.writeFileSync(path.join(LOG_DIR, "test.log"), testLog);
  if (buildLog !== null) fs.writeFileSync(path.join(LOG_DIR, "build.log"), buildLog);

  jsonWrite("artifact-summary.json", {
    artifactPaths,
    artifactCount: artifactPaths.length,
  });

  setOutput("audit_bundle_path", ".audit/PIPE-BUILD");
  console.log("✅ build evidence exported to .audit/PIPE-BUILD");
}

main();
