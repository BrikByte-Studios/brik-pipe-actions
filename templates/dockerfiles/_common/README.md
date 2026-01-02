# BrikByteOS Dockerfile Scaffolds (v1)

These scaffolds are **opinionated defaults** for BrikByteOS Pipelines.

## Goals
- Deterministic and cache-friendly layer ordering
- Works in **Buildx** and **Kaniko**
- No secrets baked into images
- Standard OCI labels via build args
- Non-root runtime where feasible

## Standard Build Args (all stacks)
- `IMAGE_SOURCE` (e.g. https://github.com/ORG/REPO)
- `VCS_REF` (git sha)
- `BUILD_DATE` (ISO8601)

## Standard OCI Labels
- `org.opencontainers.image.source`
- `org.opencontainers.image.revision`
- `org.opencontainers.image.created`
- `org.opencontainers.image.title`
- `org.opencontainers.image.description` (optional)
- `org.opencontainers.image.licenses` (optional)

## Recommended local build pattern
```bash
docker build \
  --build-arg IMAGE_SOURCE="https://github.com/BrikByte-Studios/your-repo" \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t your-image:dev .
````