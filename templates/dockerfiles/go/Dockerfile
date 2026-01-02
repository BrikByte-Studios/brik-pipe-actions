# -----------------------------------------------------------------------------
# BrikByteOS v1 — Go Dockerfile Scaffold
#
# Goals:
# - Cache-friendly: go.mod/go.sum before source
# - Static build for minimal runtime
# - Non-root runtime
# - OCI labels via safe build args
# -----------------------------------------------------------------------------

ARG IMAGE_SOURCE="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"

FROM golang:1.22-bookworm AS builder
WORKDIR /src

# Cache deps
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build static binary (adjust ./cmd/app if needed)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/app ./...

# Runtime: distroless is strong default for Go (non-root)
# If you prefer Debian slim (for shell/debug), replace this base image.
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app

ARG IMAGE_SOURCE
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.title="brikbyte-go-service" \
      org.opencontainers.image.description="BrikByteOS v1 Go scaffold" \
      org.opencontainers.image.licenses="UNLICENSED"

COPY --from=builder /out/app /app/app

# distroless:nonroot already runs as nonroot
EXPOSE 8080
ENTRYPOINT ["/app/app"]
