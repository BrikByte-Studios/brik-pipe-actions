/**
 * Export container-build evidence to .audit/PIPE-CONTAINER-BUILD (v1).
 *
 * Why:
 * - Guarantees audit continuity even when build fails (workflow uses if: always()).
 * - Provides deterministic, machine-parseable evidence for governance and regression tests.
 *
 * Evidence layout:
 * .audit/PIPE-CONTAINER-BUILD/
 *   ├─ metadata.json
 *   ├─ inputs.json
 *   ├─ outputs.json
 *   ├─ results.json
 *   └─ logs/
 *       └─ kaniko.log (if provided)
 */

import fs from "node:fs";
import path from "node:path";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function copyIfExists(src, dest) {
  if (!src) return false;
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

const auditRoot = path.resolve(".audit/PIPE-CONTAINER-BUILD");
const logsDir = path.join(auditRoot, "logs");
ensureDir(logsDir);

// Inputs (from GitHub composite action inputs are injected as INPUT_*)
const inputs = {
  builder: env("INPUT_BUILDER"),
  working_directory: env("INPUT_WORKING_DIRECTORY", "."),
  context: env("INPUT_CONTEXT", "."),
  dockerfile: env("INPUT_DOCKERFILE", "Dockerfile"),
  image_name: env("INPUT_IMAGE_NAME"),
  tags: env("INPUT_TAGS"),
  push: env("INPUT_PUSH", "false") === "true",
  cache: env("INPUT_CACHE", "true") === "true",
  cache_repo: env("INPUT_CACHE_REPO"),
  build_args: env("INPUT_BUILD_ARGS"),
  labels: env("INPUT_LABELS"),
  registry: env("INPUT_REGISTRY", "ghcr.io"),
  kaniko_log: env("INPUT_KANIKO_LOG"),
};

// Outputs (best-effort; may be empty on failure)
const outputs = {
  image_ref: env("INPUT_IMAGE_REF"),
  digest: env("INPUT_DIGEST"),
  tags_pushed: env("INPUT_TAGS_PUSHED"),
};

// Metadata (stable governance fields)
const metadata = {
  schema: "brikbyte.audit.container-build.v1",
  audit_bundle_path: ".audit/PIPE-CONTAINER-BUILD",
  timestamp: new Date().toISOString(),

  repo: env("GITHUB_REPOSITORY", "local"),
  sha: env("GITHUB_SHA", "local"),
  run_id: env("GITHUB_RUN_ID", "local"),
  run_number: env("GITHUB_RUN_NUMBER", "local"),
  attempt: env("GITHUB_RUN_ATTEMPT", "0"),
  workflow: env("GITHUB_WORKFLOW", "local"),
  job: env("GITHUB_JOB", "local"),
  actor: env("GITHUB_ACTOR", "local"),

  builder: inputs.builder,
  registry: inputs.registry,
};

// Results (verdict is inferred from job status if available)
const jobStatus = env("JOB_STATUS", "unknown"); // optional injection (not required)
const results = {
  status: jobStatus,
  push: inputs.push,
  cache: inputs.cache,
  has_digest: Boolean(outputs.digest),
};

// Persist evidence
writeJson(path.join(auditRoot, "metadata.json"), metadata);
writeJson(path.join(auditRoot, "inputs.json"), inputs);
writeJson(path.join(auditRoot, "outputs.json"), outputs);
writeJson(path.join(auditRoot, "results.json"), results);

// Logs
const copied = copyIfExists(inputs.kaniko_log, path.join(logsDir, "kaniko.log"));

if (!copied && inputs.kaniko_log) {
  // Record missing log reference (useful for debugging)
  fs.writeFileSync(
    path.join(logsDir, "kaniko.log.missing.txt"),
    `Kaniko log path was provided but not found: ${inputs.kaniko_log}\n`,
    "utf8"
  );
}

// Provide output for workflow callers
fs.appendFileSync(env("GITHUB_OUTPUT"), "audit_bundle_path=.audit/PIPE-CONTAINER-BUILD\n");
