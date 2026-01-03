/**
 * Export container-build evidence to .audit/PIPE-CONTAINER-BUILD (v1).
 *
 * Supports both builders:
 * - kaniko (daemonless)
 * - buildx (docker/buildkit)
 *
 * Evidence layout:
 * .audit/PIPE-CONTAINER-BUILD/
 *   ├─ metadata.json
 *   ├─ inputs.json
 *   ├─ outputs.json
 *   ├─ results.json
 *   └─ logs/
 *       ├─ kaniko.log (if provided)
 *       └─ buildx.log (if provided)
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

// Inputs (GitHub composite action inputs => INPUT_*)
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
  cache_mode: env("INPUT_CACHE_MODE", "disabled"),
  cache_key: env("INPUT_CACHE_KEY"),
  allow_cache_write: env("INPUT_ALLOW_CACHE_WRITE", "true") === "true",

  build_args: env("INPUT_BUILD_ARGS"),
  labels: env("INPUT_LABELS"),
  registry: env("INPUT_REGISTRY", "ghcr.io"),

  // Auth (sanitized)
  auth_mode: env("INPUT_AUTH_MODE", "none"),
  auth_method_used: env("INPUT_AUTH_METHOD_USED", "none"),

  // Logs (optional)
  kaniko_log: env("INPUT_KANIKO_LOG"),
  buildx_log: env("INPUT_BUILDX_LOG"),

  // Best-effort timing
  duration_ms: env("INPUT_DURATION_MS"),
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

  // Observability fields (no secrets)
  auth: {
    mode: inputs.auth_mode,
    method_used: inputs.auth_method_used,
  },
  cache: {
    enabled: inputs.cache,
    mode: inputs.cache_mode,
    repo: inputs.cache_repo || "",
    key: inputs.cache_key || "",
    allow_write: inputs.allow_cache_write,
  },
  duration_ms: inputs.duration_ms ? Number(inputs.duration_ms) : null,
};

// Results (verdict inferred from job status if available)
const jobStatus = env("JOB_STATUS", "unknown"); // optional injection
const results = {
  status: jobStatus,
  push: inputs.push,
  cache: inputs.cache,
  cache_mode: inputs.cache_mode,
  has_digest: Boolean(outputs.digest),
};

// Persist evidence
writeJson(path.join(auditRoot, "metadata.json"), metadata);
writeJson(path.join(auditRoot, "inputs.json"), inputs);
writeJson(path.join(auditRoot, "outputs.json"), outputs);
writeJson(path.join(auditRoot, "results.json"), results);

// Logs
const kanikoCopied = copyIfExists(inputs.kaniko_log, path.join(logsDir, "kaniko.log"));
if (!kanikoCopied && inputs.kaniko_log) {
  fs.writeFileSync(
    path.join(logsDir, "kaniko.log.missing.txt"),
    `Kaniko log path was provided but not found: ${inputs.kaniko_log}\n`,
    "utf8"
  );
}

const buildxCopied = copyIfExists(inputs.buildx_log, path.join(logsDir, "buildx.log"));
if (!buildxCopied && inputs.buildx_log) {
  fs.writeFileSync(
    path.join(logsDir, "buildx.log.missing.txt"),
    `Buildx log path was provided but not found: ${inputs.buildx_log}\n`,
    "utf8"
  );
}

// Provide output for workflow callers
fs.appendFileSync(env("GITHUB_OUTPUT"), "audit_bundle_path=.audit/PIPE-CONTAINER-BUILD\n");
