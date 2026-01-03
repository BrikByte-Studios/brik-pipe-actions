/**
 * container-registry-auth (v1)
 *
 * Purpose:
 * - Provide a single canonical registry auth contract for container builds.
 * - OIDC-first (cloud registries), secrets fallback, or none for build-only.
 * - Never prints secrets. No set -x behavior.
 *
 * Notes:
 * - For Buildx: we primarily rely on docker/login-action in workflow for secrets mode.
 *   This action still enforces contract + emits standardized outputs for evidence.
 * - For Kaniko: we generate DOCKER_CONFIG/config.json for secrets mode.
 * - OIDC: this action does NOT perform provider logins itself (provider-specific actions do that).
 *   It validates inputs and emits method_used=oidc for evidence.
 */

import fs from "node:fs";
import path from "node:path";

function getEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}
function setOutput(k, v) {
  process.stdout.write(`::set-output name=${k}::${String(v)}\n`);
}
function notice(msg) {
  process.stdout.write(`::notice::${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`::error::container-registry-auth: ${msg}\n`);
  process.exit(1);
}

/**
 * Some registries use a different auth host than the tag registry name.
 * Keep v1 minimal: default to INPUT_REGISTRY.
 * If you later need Docker Hub:
 * - registry: index.docker.io for login, but image refs may omit it (library/..).
 */
function normalizeAuthHost(registry) {
  return registry.trim();
}

const registry = getEnv("INPUT_REGISTRY", "ghcr.io");
const authMode = getEnv("INPUT_AUTH_MODE", "none");
const builder = getEnv("INPUT_BUILDER");
const push = getEnv("INPUT_PUSH", "false") === "true";

if (!builder) fail("builder is required (buildx|kaniko)");
if (!["buildx", "kaniko"].includes(builder)) fail(`unsupported builder: ${builder}`);
if (!["none", "secrets", "oidc"].includes(authMode)) fail(`unsupported auth_mode: ${authMode}`);

// If not pushing, auth can be none.
if (!push && authMode !== "none") {
  notice(`push=false, but auth_mode=${authMode}. Continuing (auth may still be needed for private bases).`);
}

const authHost = normalizeAuthHost(registry);
let methodUsed = authMode;
let authConfigPath = "";

// Secrets baseline: validate inputs for secrets mode.
if (authMode === "secrets") {
  const user = getEnv("INPUT_REGISTRY_USERNAME");
  const pass = getEnv("INPUT_REGISTRY_PASSWORD");
  if (!user || !pass) {
    fail(`auth_mode=secrets requires registry_username and registry_password (secrets).`);
  }

  // For Kaniko, generate DOCKER_CONFIG/config.json locally.
  if (builder === "kaniko") {
    const dockerConfigDir = path.resolve(".docker-config");
    fs.mkdirSync(dockerConfigDir, { recursive: true });

    // Create auth JSON without printing secrets.
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const config = {
      auths: {
        [authHost]: { auth },
      },
    };

    fs.writeFileSync(path.join(dockerConfigDir, "config.json"), JSON.stringify(config, null, 2), "utf8");
    authConfigPath = dockerConfigDir;
    notice(`Kaniko DOCKER_CONFIG prepared for ${authHost} (secrets not printed).`);
  } else {
    // Buildx: actual login should be performed with docker/login-action@v3 in workflow
    // (so we do not handle docker CLI here).
    notice(`Buildx secrets auth expected via docker/login-action@v3 (workflow-level).`);
  }
}

// OIDC mode: validate that workflow likely has id-token permission; actual login is provider-specific.
if (authMode === "oidc") {
  // Minimal validation: require an oidc_provider hint OR workload identity info if provided.
  const provider = getEnv("INPUT_OIDC_PROVIDER");
  const wip = getEnv("INPUT_WORKLOAD_IDENTITY_PROVIDER");
  const sa = getEnv("INPUT_OIDC_SERVICE_ACCOUNT");

  if (!provider && !wip && !sa) {
    notice(
      `auth_mode=oidc selected. Provider-specific login action must be used (aws/gcp/azure). No provider hints provided.`
    );
  } else {
    notice(`OIDC hints: provider=${provider || "n/a"} wip=${wip ? "set" : "n/a"} service_account=${sa ? "set" : "n/a"}`);
  }
}

setOutput("method_used", methodUsed);
setOutput("auth_config_path", authConfigPath);
setOutput("registry_host_for_auth", authHost);
