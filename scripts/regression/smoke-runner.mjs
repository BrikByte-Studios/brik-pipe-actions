/**
 * Smoke runner for Build Automation v1 (examples).
 *
 * What this does:
 * - reads validator output (resolved config) from `.audit/PIPE-BUILD/validation/build-config.resolved.json`
 * - executes install/lint/test/build in the example repo working directory
 * - writes evidence logs to `.audit/PIPE-BUILD/smoke/<stack>/...`
 *
 * Why:
 * - This is the integration test that prevents template drift.
 * - We validate the contract end-to-end without needing to trigger cross-repo workflow_dispatch.
 *
 * NOTE:
 * This runner intentionally avoids any network calls except dependency installs
 * (which are part of the build contract).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const stack = process.env.STACK;
const exampleDir = process.env.EXAMPLE_DIR;
const evidenceRoot = process.env.EVIDENCE_ROOT || ".audit/PIPE-BUILD/smoke/unknown";

function fail(msg) {
  console.error(`❌ smoke-runner: ${msg}`);
  process.exit(1);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

/** Execute a command with bash -lc so Makefile + shell scripts work consistently. */
function runStep(stepName, cmd, cwd) {
  const stepDir = path.join(evidenceRoot, stepName);
  ensureDir(stepDir);

  const logPath = path.join(stepDir, "command.log");
  writeFile(path.join(stepDir, "command.txt"), cmd);

  const res = spawnSync("bash", ["-lc", cmd], {
    cwd,
    env: { ...process.env },
    encoding: "utf8",
  });

  const log = [
    `# step: ${stepName}`,
    `# cwd: ${cwd}`,
    `# cmd: ${cmd}`,
    `# exit: ${res.status}`,
    "",
    res.stdout || "",
    res.stderr || "",
  ].join("\n");

  writeFile(logPath, log);

  if (res.status !== 0) {
    // Fail fast, but evidence already written.
    fail(`Step "${stepName}" failed (exit ${res.status}). See ${logPath}`);
  }
}

if (!stack) fail("STACK env missing");
if (!exampleDir) fail("EXAMPLE_DIR env missing");

const resolvedPath = path.join(process.cwd(), ".audit/PIPE-BUILD/validation/build-config.resolved.json");
if (!fs.existsSync(resolvedPath)) {
  fail(`Resolved config not found at ${resolvedPath} (did validator run?)`);
}

const resolved = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
const wd = resolved?.workingDirectory || ".";
const cwd = path.resolve(exampleDir, wd);

ensureDir(evidenceRoot);

// Minimal metadata for governance/evidence checks
writeFile(
  path.join(evidenceRoot, "metadata.json"),
  JSON.stringify(
    {
      repo: process.env.GITHUB_REPOSITORY || "local",
      sha: process.env.GITHUB_SHA || "local",
      run_id: process.env.GITHUB_RUN_ID || "local",
      workflow: process.env.GITHUB_WORKFLOW || "local",
      stack,
      runtime_used: resolved?.runtime?.version ?? null,
      tool_used: resolved?.tool?.kind ?? null,
      timestamp: new Date().toISOString(),
      exampleDir,
      workingDirectory: wd,
    },
    null,
    2
  )
);

// Execute steps according to flags
runStep("install", String(resolved?.commands?.install || ""), cwd);

if (resolved?.flags?.runLint) {
  runStep("lint", String(resolved?.commands?.lint || ""), cwd);
}

if (resolved?.flags?.runTests) {
  runStep("test", String(resolved?.commands?.test || ""), cwd);
}

// build is mandatory
runStep("build", String(resolved?.commands?.build || ""), cwd);

console.log(`✅ smoke-runner: OK (${stack}) evidence at ${evidenceRoot}`);
