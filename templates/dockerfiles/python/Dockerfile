# -----------------------------------------------------------------------------
# BrikByteOS v1 — Python Dockerfile Scaffold
#
# Goals:
# - Deterministic dependency layer caching
# - Small runtime footprint
# - Non-root runtime
# - OCI labels via safe build args
# -----------------------------------------------------------------------------

ARG IMAGE_SOURCE="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"

FROM python:3.11-slim AS builder
WORKDIR /app

# System deps (minimize; add only if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first for caching
COPY requirements.txt ./requirements.txt

# Build wheels for deterministic install in runtime stage
RUN pip install --upgrade pip && \
    pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# Copy source last
COPY . .

FROM python:3.11-slim AS runtime
WORKDIR /app

# Create non-root user
RUN useradd -m -u 10001 pyapp

ARG IMAGE_SOURCE
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.title="brikbyte-python-service" \
      org.opencontainers.image.description="BrikByteOS v1 Python scaffold" \
      org.opencontainers.image.licenses="UNLICENSED"

# Install from wheels (fast + deterministic)
COPY --from=builder /wheels /wheels
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt && \
    rm -rf /wheels

# Copy app source
COPY . .

USER 10001
EXPOSE 8000

# Default assumes ASGI app at app:app (FastAPI/Starlette)
CMD ["python", "-m", "uvicorn", "app:app", "--host=0.0.0.0", "--port=8000"]