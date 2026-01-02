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
##

# ---------- Inputs ----------
WORKING_DIRECTORY="${INPUT_WORKING_DIRECTORY:-.}"
CONTEXT_REL="${INPUT_CONTEXT:-.}"
DOCKERFILE_REL="${INPUT_DOCKERFILE:-Dockerfile}"

IMAGE_NAME="${INPUT_IMAGE_NAME:?image_name is required}"
TAGS_RAW="${INPUT_TAGS:?tags is required}"

PUSH="${INPUT_PUSH:-false}"
CACHE="${INPUT_CACHE:-true}"
CACHE_REPO="${INPUT_CACHE_REPO:-}"

BUILD_ARGS_RAW="${INPUT_BUILD_ARGS:-}"
LABELS_RAW="${INPUT_LABELS:-}"
REGISTRY="${INPUT_REGISTRY:-ghcr.io}"

# From workflow env (secrets)
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
[ -d "${WD}" ] || fail "working_directory not found: ${WD}"
[ -d "${CONTEXT_PATH}" ] || fail "context path not found: ${CONTEXT_PATH}"
[ -f "${DOCKERFILE_PATH}" ] || fail "dockerfile not found: ${DOCKERFILE_PATH}"

# Tags normalization
TAGS_NL="$(normalize_list "${TAGS_RAW}")"
[ -n "${TAGS_NL}" ] || fail "tags list is empty after normalization"

# Record normalized tags
TAGS_PUSHED="$(echo "${TAGS_NL}" | paste -sd ',' -)"
echo "${TAGS_NL}" > "${DESTINATIONS_FILE}"

# Prepare destinations (image_name:tag)
DEST_ARGS=()
while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  DEST_ARGS+=( "--destination=${IMAGE_NAME}:${tag}" )
done <<< "${TAGS_NL}"

# Auth only required if push=true OR cache_repo set and requires auth
if [ "${PUSH}" = "true" ]; then
  if [ -z "${REGISTRY_USERNAME}" ] || [ -z "${REGISTRY_PASSWORD}" ]; then
    fail "push=true requires REGISTRY_USERNAME and REGISTRY_PASSWORD secrets"
  fi
fi

# Write docker config for Kaniko (DO NOT ECHO SECRETS)
mkdir -p "${DOCKER_CONFIG_DIR}/.docker"
CONFIG_JSON="${DOCKER_CONFIG_DIR}/.docker/config.json"

# If username/password are not provided, write an empty config (build-only can still run).
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

# Build args & labels -> Kaniko flags
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

# Cache flags
CACHE_FLAGS=()
if [ "${CACHE}" = "true" ]; then
  CACHE_FLAGS+=( "--cache=true" )
  if [ -n "${CACHE_REPO}" ]; then
    CACHE_FLAGS+=( "--cache-repo=${CACHE_REPO}" )
  fi
else
  CACHE_FLAGS+=( "--cache=false" )
fi

# Push flags
PUSH_FLAGS=()
if [ "${PUSH}" = "true" ]; then
  : # default behavior pushes destinations
else
  PUSH_FLAGS+=( "--no-push" )
fi

# Pin Kaniko version to avoid surprise breakage
KANIKO_IMAGE="gcr.io/kaniko-project/executor:v1.23.2"

# Run Kaniko
# NOTE:
# This launches Kaniko as a container. Kaniko itself builds without docker daemon.
# In environments with no container runtime, this cannot execute.
{
  echo "brik: kaniko build start"
  echo "image_name: ${IMAGE_NAME}"
  echo "tags: ${TAGS_PUSHED}"
  echo "push: ${PUSH}"
  echo "context: ${CONTEXT_PATH}"
  echo "dockerfile: ${DOCKERFILE_PATH}"
  echo "cache: ${CACHE} cache_repo: ${CACHE_REPO}"
  echo "kaniko_image: ${KANIKO_IMAGE}"
} > "${KANIKO_LOG}"

# IMPORTANT: do NOT set -x; and never print config.json
set +x

# Create digest file only if kaniko writes one; we still create empty file for evidence consistency
: > "${DIGEST_FILE}"

# Execute
docker run --rm \
  -v "${CONTEXT_PATH}:/workspace" \
  -v "${DOCKER_CONFIG_DIR}:/kaniko" \
  "${KANIKO_IMAGE}" \
  --context=dir:///workspace \
  --dockerfile="/workspace/$(realpath --relative-to="${CONTEXT_PATH}" "${DOCKERFILE_PATH}")" \
  "${DEST_ARGS[@]}" \
  "${PUSH_FLAGS[@]}" \
  "${CACHE_FLAGS[@]}" \
  "${BUILD_ARG_FLAGS[@]}" \
  "${LABEL_FLAGS[@]}" \
  --digest-file="/workspace/.kaniko-digest.txt" \
  >> "${KANIKO_LOG}" 2>&1 || {
    # Capture digest if present even on failure
    if [ -f "${CONTEXT_PATH}/.kaniko-digest.txt" ]; then
      cp "${CONTEXT_PATH}/.kaniko-digest.txt" "${DIGEST_FILE}" || true
    fi
    fail "Kaniko executor failed. See ${KANIKO_LOG}"
  }

# Copy digest out of workspace if present
if [ -f "${CONTEXT_PATH}/.kaniko-digest.txt" ]; then
  cp "${CONTEXT_PATH}/.kaniko-digest.txt" "${DIGEST_FILE}" || true
fi

DIGEST="$(cat "${DIGEST_FILE}" | tr -d '\n' || true)"

# Outputs
{
  echo "image_ref=${IMAGE_NAME}"
  echo "digest=${DIGEST}"
  echo "tags_pushed=${TAGS_PUSHED}"
  echo "kaniko_log=${KANIKO_LOG}"
} >> "${GITHUB_OUTPUT}"
