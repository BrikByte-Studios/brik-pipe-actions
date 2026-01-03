#!/usr/bin/env bash
set -euo pipefail

##
# brik: container-build-kaniko (v1)
#
# Purpose:
# - Run a daemonless container build using Kaniko with safe defaults.
# - Supports:
#     - build-only (no push)
#     - build+push
#     - remote caching (where supported)
#
# Security:
# - Never prints registry credentials.
# - Avoids xtrace.
#
# Outputs (to GITHUB_OUTPUT):
# - image_ref
# - digest
# - tags_pushed
# - kaniko_log
# - duration_ms
##

# ---------- Inputs ----------
WORKING_DIRECTORY="${BRK_WORKING_DIRECTORY:-${INPUT_WORKING_DIRECTORY:-.}}"
CONTEXT_REL="${BRK_CONTEXT:-${INPUT_CONTEXT:-.}}"
DOCKERFILE_REL="${BRK_DOCKERFILE:-${INPUT_DOCKERFILE:-Dockerfile}}"

IMAGE_NAME="${BRK_IMAGE_NAME:-${INPUT_IMAGE_NAME:-}}"
TAGS_RAW="${BRK_TAGS:-${INPUT_TAGS:-}}"

PUSH="${BRK_PUSH:-${INPUT_PUSH:-false}}"
CACHE="${BRK_CACHE:-${INPUT_CACHE:-true}}"
CACHE_REPO="${BRK_CACHE_REPO:-${INPUT_CACHE_REPO:-}}"

# Safe cache write control (fork/untrusted contexts can disable writes)
ALLOW_CACHE_WRITE="${BRK_ALLOW_CACHE_WRITE:-${INPUT_ALLOW_CACHE_WRITE:-true}}"

BUILD_ARGS_RAW="${BRK_BUILD_ARGS:-${INPUT_BUILD_ARGS:-}}"
LABELS_RAW="${BRK_LABELS:-${INPUT_LABELS:-}}"
REGISTRY="${BRK_REGISTRY:-${INPUT_REGISTRY:-ghcr.io}}"

# Prefer auth-prepared docker config dir (from container-registry-auth helper)
DOCKER_CONFIG_DIR_IN="${BRK_DOCKER_CONFIG_DIR:-${INPUT_DOCKER_CONFIG_DIR:-}}"

# From workflow env (secrets) - ONLY used if DOCKER_CONFIG_DIR_IN not provided
REGISTRY_USERNAME="${REGISTRY_USERNAME:-}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"

# ---------- Paths ----------
ROOT="$(pwd)"
WD="${ROOT}/${WORKING_DIRECTORY}"

CONTEXT_PATH="${WD}/${CONTEXT_REL}"
DOCKERFILE_PATH="${WD}/${DOCKERFILE_REL}"

RUNNER_TMP="${RUNNER_TEMP:-/tmp}"
AUDIT_TMP="${RUNNER_TMP}/brik/kaniko"
mkdir -p "${AUDIT_TMP}"

KANIKO_LOG="${AUDIT_TMP}/kaniko.log"
DIGEST_FILE="${AUDIT_TMP}/digest.txt"
DESTINATIONS_FILE="${AUDIT_TMP}/destinations.txt"
DOCKER_CONFIG_DIR="${AUDIT_TMP}/docker-config"

# ---------- Helpers ----------
fail() {
  echo "❌ container-build-kaniko: $*" >&2
  exit 1
}

trim() {
  # shellcheck disable=SC2001
  echo "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

normalize_list() {
  # Accept newline OR comma separated; output as newline list.
  local raw="${1:-}"
  if [ -z "$(trim "$raw")" ]; then
    return 0
  fi
  echo "$raw" | tr ',' '\n' | sed '/^[[:space:]]*$/d' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

# ---------- Preconditions ----------
[ -n "${IMAGE_NAME}" ] || fail "image_name is required"
[ -n "${TAGS_RAW}" ] || fail "tags is required"
[ -d "${WD}" ] || fail "working_directory not found: ${WD}"
[ -d "${CONTEXT_PATH}" ] || fail "context path not found: ${CONTEXT_PATH}"
[ -f "${DOCKERFILE_PATH}" ] || fail "dockerfile not found: ${DOCKERFILE_PATH}"

# Initialize log early (so sanitizer can append)
: > "${KANIKO_LOG}"

# ---------- Sanitization (registry-safe) ----------
# Kaniko enforces Docker registry naming rules:
# repo/name must be lowercase and only [a-z0-9._/-]
orig_image_name="${IMAGE_NAME}"
orig_cache_repo="${CACHE_REPO}"
orig_registry="${REGISTRY}"

# Lowercase identifiers (GitHub org/repo names may contain uppercase)
IMAGE_NAME="$(echo "${IMAGE_NAME}" | tr '[:upper:]' '[:lower:]')"
CACHE_REPO="$(echo "${CACHE_REPO}" | tr '[:upper:]' '[:lower:]')"
REGISTRY="$(echo "${REGISTRY}" | tr '[:upper:]' '[:lower:]')"

# image_name must be name-only (no tag)
if echo "${IMAGE_NAME}" | grep -q ':'; then
  fail "image_name must NOT include a tag. Provide name only (no ':tag'). Got: '${orig_image_name}'"
fi

# Validate docker repository name segments:
# - Allow nested paths (org/repo/image)
# - Segments: start with alnum, then alnum or separators . _ -
# This is conservative and matches Kaniko's common enforcement.
if ! echo "${IMAGE_NAME}" | grep -Eq '^[a-z0-9]+([._-]?[a-z0-9]+)*(\/[a-z0-9]+([._-]?[a-z0-9]+)*)*$'; then
  fail "image_name contains invalid characters. After sanitize: '${IMAGE_NAME}'. Original: '${orig_image_name}'. Allowed: lowercase [a-z0-9._/-]"
fi

if [ -n "${CACHE_REPO}" ]; then
  if echo "${CACHE_REPO}" | grep -q ':'; then
    fail "cache_repo must NOT include a tag. Got: '${orig_cache_repo}'"
  fi

  if ! echo "${CACHE_REPO}" | grep -Eq '^[a-z0-9]+([._-]?[a-z0-9]+)*(\/[a-z0-9]+([._-]?[a-z0-9]+)*)*$'; then
    fail "cache_repo contains invalid characters. After sanitize: '${CACHE_REPO}'. Original: '${orig_cache_repo}'. Allowed: lowercase [a-z0-9._/-]"
  fi
fi

# Log sanitization (safe—no secrets)
if [ "${orig_image_name}" != "${IMAGE_NAME}" ] || [ "${orig_cache_repo}" != "${CACHE_REPO}" ] || [ "${orig_registry}" != "${REGISTRY}" ]; then
  {
    echo "ℹ️ container-build-kaniko: sanitized identifiers to lowercase for registry compliance"
    echo "  image_name: ${orig_image_name} -> ${IMAGE_NAME}"
    if [ -n "${orig_cache_repo}" ] || [ -n "${CACHE_REPO}" ]; then
      echo "  cache_repo: ${orig_cache_repo} -> ${CACHE_REPO}"
    fi
    echo "  registry: ${orig_registry} -> ${REGISTRY}"
  } >> "${KANIKO_LOG}"
fi

# ---------- Tags normalization ----------
TAGS_NL="$(normalize_list "${TAGS_RAW}")"
[ -n "${TAGS_NL}" ] || fail "tags list is empty after normalization"

TAGS_PUSHED="$(echo "${TAGS_NL}" | paste -sd ',' -)"
echo "${TAGS_NL}" > "${DESTINATIONS_FILE}"

# Prepare destinations (image_name:tag)
DEST_ARGS=()
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  DEST_ARGS+=( "--destination=${IMAGE_NAME}:${tag}" )
done <<< "${TAGS_NL}"

# ---------- Auth only required if push=true ----------
if [ "${PUSH}" = "true" ]; then
  # If caller provided docker_config_dir, we use that and do not require env secrets here.
  if [ -z "${DOCKER_CONFIG_DIR_IN}" ]; then
    if [ -z "${REGISTRY_USERNAME}" ] || [ -z "${REGISTRY_PASSWORD}" ]; then
      fail "push=true requires REGISTRY_USERNAME and REGISTRY_PASSWORD secrets (or provide docker_config_dir from auth helper)"
    fi
  fi
fi

# ---------- Docker config for Kaniko ----------
# If workflow provided docker_config_dir (from auth helper), use it.
# Otherwise, generate one from REGISTRY_USERNAME/PASSWORD (legacy support).
if [ -n "${DOCKER_CONFIG_DIR_IN}" ]; then
  if [ -f "${DOCKER_CONFIG_DIR_IN}/config.json" ]; then
    # expect to mount as /kaniko/.docker/config.json, so wrap into .docker
    mkdir -p "${DOCKER_CONFIG_DIR}/.docker"
    cp "${DOCKER_CONFIG_DIR_IN}/config.json" "${DOCKER_CONFIG_DIR}/.docker/config.json"
  elif [ -f "${DOCKER_CONFIG_DIR_IN}/.docker/config.json" ]; then
    # copy the .docker folder
    mkdir -p "${DOCKER_CONFIG_DIR}"
    rm -rf "${DOCKER_CONFIG_DIR}/.docker"
    cp -R "${DOCKER_CONFIG_DIR_IN}/.docker" "${DOCKER_CONFIG_DIR}/.docker"
  else
    fail "docker_config_dir provided but no config.json found under: ${DOCKER_CONFIG_DIR_IN}"
  fi
else
  mkdir -p "${DOCKER_CONFIG_DIR}/.docker"
  CONFIG_JSON="${DOCKER_CONFIG_DIR}/.docker/config.json"

  if [ -n "${REGISTRY_USERNAME}" ] && [ -n "${REGISTRY_PASSWORD}" ]; then
    AUTH_B64="$(printf "%s:%s" "${REGISTRY_USERNAME}" "${REGISTRY_PASSWORD}" | base64 | tr -d '\n')"
    cat > "${CONFIG_JSON}" <<EOF
{
  "auths": {
    "${REGISTRY}": {
      "auth": "${AUTH_B64}"
    }
  }
}
EOF
  else
    cat > "${CONFIG_JSON}" <<EOF
{ "auths": {} }
EOF
  fi
fi

# ---------- Build args & labels -> Kaniko flags ----------
BUILD_ARG_FLAGS=()
while IFS= read -r kv; do
  [ -n "$kv" ] || continue
  BUILD_ARG_FLAGS+=( "--build-arg=${kv}" )
done <<< "$(normalize_list "${BUILD_ARGS_RAW}")"

LABEL_FLAGS=()
while IFS= read -r kv; do
  [ -n "$kv" ] || continue
  LABEL_FLAGS+=( "--label=${kv}" )
done <<< "$(normalize_list "${LABELS_RAW}")"

# ---------- Cache flags ----------
CACHE_FLAGS=()
if [ "${CACHE}" = "true" ]; then
  CACHE_FLAGS+=( "--cache=true" )
  if [ -n "${CACHE_REPO}" ]; then
    CACHE_FLAGS+=( "--cache-repo=${CACHE_REPO}" )
  fi

  # Safe default for forks/untrusted contexts: reduce cache writes
  if [ "${ALLOW_CACHE_WRITE}" != "true" ]; then
    # Best-effort: keep cache reads but prevent copying layers into cache.
    # If your environment still misbehaves, switch to hard disable by setting CACHE=false in caller.
    CACHE_FLAGS+=( "--cache-copy-layers=false" )
  fi
else
  CACHE_FLAGS+=( "--cache=false" )
fi

# ---------- Push flags ----------
PUSH_FLAGS=()
if [ "${PUSH}" = "true" ]; then
  : # default behavior pushes destinations
else
  PUSH_FLAGS+=( "--no-push" )
fi

# ---------- Kaniko version ----------
KANIKO_IMAGE="gcr.io/kaniko-project/executor:v1.23.2"

# ---------- Log header ----------
{
  echo "brik: kaniko build start"
  echo "image_name: ${IMAGE_NAME}"
  echo "tags: ${TAGS_PUSHED}"
  echo "push: ${PUSH}"
  echo "context: ${CONTEXT_PATH}"
  echo "dockerfile: ${DOCKERFILE_PATH}"
  echo "cache: ${CACHE} cache_repo: ${CACHE_REPO}"
  echo "allow_cache_write: ${ALLOW_CACHE_WRITE}"
  echo "kaniko_image: ${KANIKO_IMAGE}"
} >> "${KANIKO_LOG}"

# IMPORTANT: do NOT set -x; and never print config.json
set +x

# Create digest file placeholder for evidence consistency
: > "${DIGEST_FILE}"

START_MS="$(date +%s%3N)"

# Compute dockerfile relative path under context (required by our /workspace mount)
DOCKERFILE_REL_TO_CTX="$(realpath --relative-to="${CONTEXT_PATH}" "${DOCKERFILE_PATH}" 2>/dev/null || true)"
if [ -z "${DOCKERFILE_REL_TO_CTX}" ]; then
  fail "failed to compute dockerfile path relative to context. context='${CONTEXT_PATH}', dockerfile='${DOCKERFILE_PATH}'"
fi

# Execute Kaniko via container runtime (GitHub hosted runners have docker)
docker run --rm \
  -v "${CONTEXT_PATH}:/workspace" \
  -v "${DOCKER_CONFIG_DIR}/.docker:/kaniko/.docker:ro" \
  "${KANIKO_IMAGE}" \
  --context=dir:///workspace \
  --dockerfile="/workspace/${DOCKERFILE_REL_TO_CTX}" \
  "${DEST_ARGS[@]}" \
  "${PUSH_FLAGS[@]}" \
  "${CACHE_FLAGS[@]}" \
  "${BUILD_ARG_FLAGS[@]}" \
  "${LABEL_FLAGS[@]}" \
  --digest-file="/workspace/.kaniko-digest.txt" \
  >> "${KANIKO_LOG}" 2>&1 || {
    rc=$?
    if [ -f "${CONTEXT_PATH}/.kaniko-digest.txt" ]; then
      cp "${CONTEXT_PATH}/.kaniko-digest.txt" "${DIGEST_FILE}" || true
    fi
    echo "❌ Kaniko executor failed (exit=${rc}). Showing last 200 log lines:" >&2
    echo "----- kaniko.log (tail) -----" >&2
    tail -n 200 "${KANIKO_LOG}" >&2 || true
    echo "-----------------------------" >&2
    fail "Kaniko executor failed. See ${KANIKO_LOG}"
  }

# Copy digest out of workspace if present
if [ -f "${CONTEXT_PATH}/.kaniko-digest.txt" ]; then
  cp "${CONTEXT_PATH}/.kaniko-digest.txt" "${DIGEST_FILE}" || true
fi

DIGEST="$(cat "${DIGEST_FILE}" | tr -d '\n' || true)"
END_MS="$(date +%s%3N)"
DURATION_MS="$((END_MS-START_MS))"

# Outputs (GITHUB_OUTPUT is provided by GitHub Actions)
{
  echo "image_ref=${IMAGE_NAME}"
  echo "digest=${DIGEST}"
  echo "tags_pushed=${TAGS_PUSHED}"
  echo "kaniko_log=${KANIKO_LOG}"
  echo "duration_ms=${DURATION_MS}"
} >> "${GITHUB_OUTPUT}"
