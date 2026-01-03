/**
 * container-cache-config (v1)
 *
 * Goals:
 * - Standardize caching across Buildx and Kaniko.
 * - Avoid cache poisoning by supporting "disable write" on fork PRs/untrusted contexts.
 * - Produce normalized cache-from/cache-to strings and a sanitized cache_key for evidence.
 *
 * Builder rules:
 * - buildx: cache_mode=gha|registry
 * - kaniko: cache_mode=registry only (gha not supported)
 */

import crypto from "node:crypto";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}
function out(k, v) {
  process.stdout.write(`::set-output name=${k}::${String(v)}\n`);
}
function notice(msg) {
  process.stdout.write(`::notice::${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`::error::container-cache-config: ${msg}\n`);
  process.exit(1);
}

const builder = env("INPUT_BUILDER");
const cacheEnabled = env("INPUT_CACHE_ENABLED", "true") === "true";
let cacheMode = env("INPUT_CACHE_MODE", "gha");
const cacheRepo = env("INPUT_CACHE_REPO", "");
const allowWrite = env("INPUT_ALLOW_CACHE_WRITE", "true") === "true";
const cacheScope = env("INPUT_CACHE_SCOPE", "").trim();
const dockerfile = env("INPUT_DOCKERFILE", "Dockerfile");

if (!["buildx", "kaniko"].includes(builder)) fail(`unsupported builder: ${builder}`);

if (!cacheEnabled) {
  out("cache_enabled", "false");
  out("cache_mode", "disabled");
  out("cache_repo", "");
  out("cache_from", "");
  out("cache_to", "");
  out("kaniko_cache_args", "--cache=false");
  out("cache_key", "");
  process.exit(0);
}

// Enforce Kaniko rules
if (builder === "kaniko") {
  cacheMode = "registry";
  if (!cacheRepo) {
    notice("Kaniko cache enabled but cache_repo empty → disabling cache to avoid confusing no-op.");
    out("cache_enabled", "false");
    out("cache_mode", "disabled");
    out("cache_repo", "");
    out("cache_from", "");
    out("cache_to", "");
    out("kaniko_cache_args", "--cache=false");
    out("cache_key", "");
    process.exit(0);
  }
}

// Build cache key: repo + dockerfile + optional scope (stack)
const repo = env("GITHUB_REPOSITORY", "local");
const keyRaw = `${repo}|${dockerfile}|${cacheScope || "default"}`;
const key = crypto.createHash("sha256").update(keyRaw).digest("hex").slice(0, 16);

let cacheFrom = "";
let cacheTo = "";
let kanikoArgs = "--cache=true";

if (builder === "buildx") {
  if (!["gha", "registry"].includes(cacheMode)) fail(`buildx cache_mode must be gha|registry, got: ${cacheMode}`);

  if (cacheMode === "gha") {
    cacheFrom = "type=gha";
    cacheTo = allowWrite ? "type=gha,mode=max" : "";
    if (!allowWrite) notice("Cache writes disabled (allow_cache_write=false). Using cache-from only.");
  }

  if (cacheMode === "registry") {
    if (!cacheRepo) fail("cache_mode=registry requires cache_repo");
    cacheFrom = `type=registry,ref=${cacheRepo}`;
    cacheTo = allowWrite ? `type=registry,ref=${cacheRepo},mode=max` : "";
    if (!allowWrite) notice("Registry cache writes disabled (allow_cache_write=false). Using cache-from only.");
  }
}

if (builder === "kaniko") {
  // Kaniko only supports registry cache.
  kanikoArgs = allowWrite
    ? `--cache=true --cache-repo=${cacheRepo}`
    : `--cache=true --cache-repo=${cacheRepo} --cache-readonly=true`;
}

out("cache_enabled", "true");
out("cache_mode", builder === "kaniko" ? "registry" : cacheMode);
out("cache_repo", cacheRepo);
out("cache_from", cacheFrom);
out("cache_to", cacheTo);
out("kaniko_cache_args", kanikoArgs);
out("cache_key", `cb_${key}`);
