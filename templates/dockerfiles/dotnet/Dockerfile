# -----------------------------------------------------------------------------
# BrikByteOS v1 — .NET Dockerfile Scaffold
#
# Goals:
# - Cache-friendly: csproj restore before source
# - Multi-stage: build/publish -> runtime
# - Non-root runtime
# - OCI labels via safe build args
# -----------------------------------------------------------------------------

ARG IMAGE_SOURCE="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder
WORKDIR /src

# Copy csproj(s) first for restore caching
# NOTE: adjust paths to your solution structure
COPY *.sln ./
COPY src/**/*.csproj ./src/

# Restore
RUN dotnet restore

# Copy remaining source
COPY . .

# Publish (self-contained false; relies on runtime image)
RUN dotnet publish -c Release -o /out --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Non-root user (aspnet images support user creation)
RUN useradd -m -u 10001 dotnetapp

ARG IMAGE_SOURCE
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.title="brikbyte-dotnet-service" \
      org.opencontainers.image.description="BrikByteOS v1 .NET scaffold" \
      org.opencontainers.image.licenses="UNLICENSED"

COPY --from=builder /out /app

USER 10001
EXPOSE 8080

# NOTE: replace with your assembly name
CMD ["dotnet", "YourService.dll"]
