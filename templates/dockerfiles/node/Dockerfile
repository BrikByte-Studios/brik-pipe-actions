# -----------------------------------------------------------------------------
# BrikByteOS v1 — Node Dockerfile Scaffold
#
# Goals:
# - Deterministic installs via lockfile
# - Cache-friendly: deps before source
# - Multi-stage: builder -> runtime
# - Non-root runtime
# - OCI labels via build args (traceability)
# -----------------------------------------------------------------------------

# ---- Base build args (used for labels; safe non-secret values only)
ARG IMAGE_SOURCE="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"

# ---- Builder stage
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Copy only dependency manifests first for better caching
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install dependencies deterministically.
# NOTE: choose one by repo convention; this default assumes npm + package-lock.
RUN npm ci

# Now copy the rest of the source
COPY . .

# Build output: expects "npm run build" to produce ./dist
RUN npm run build

# Prune dev deps for smaller runtime image (npm only)
RUN npm prune --omit=dev

# ---- Runtime stage
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Create non-root user
RUN useradd -m -u 10001 nodeapp

# OCI labels (standardized)
ARG IMAGE_SOURCE
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.title="brikbyte-node-service" \
      org.opencontainers.image.description="BrikByteOS v1 Node scaffold" \
      org.opencontainers.image.licenses="UNLICENSED"

# Copy only what we need to run
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/dist /app/dist

USER 10001

# Adjust if your service uses a different port
EXPOSE 3000

# Default: run built output
CMD ["node", "dist/index.js"]
