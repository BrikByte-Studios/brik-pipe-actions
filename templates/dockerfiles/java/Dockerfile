# -----------------------------------------------------------------------------
# BrikByteOS v1 — Java Dockerfile Scaffold (Maven)
#
# Goals:
# - Cache-friendly: pom.xml before source
# - Multi-stage: build -> runtime
# - Non-root runtime
# - OCI labels via safe build args
# -----------------------------------------------------------------------------

ARG IMAGE_SOURCE="unknown"
ARG VCS_REF="unknown"
ARG BUILD_DATE="unknown"

FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app

# Copy pom first for dependency cache
COPY pom.xml ./pom.xml
RUN mvn -q -e -DskipTests dependency:go-offline

# Copy source after deps are cached
COPY src ./src

# Build jar (adjust if your jar name differs)
RUN mvn -q -e -DskipTests package

FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app

# Non-root user
RUN useradd -m -u 10001 javaapp

ARG IMAGE_SOURCE
ARG VCS_REF
ARG BUILD_DATE
LABEL org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE \
      org.opencontainers.image.title="brikbyte-java-service" \
      org.opencontainers.image.description="BrikByteOS v1 Java scaffold" \
      org.opencontainers.image.licenses="UNLICENSED"

# Copy built jar
COPY --from=builder /app/target/*.jar /app/app.jar

USER 10001
EXPOSE 8080

# JVM flags kept minimal; tune per service
CMD ["java", "-jar", "/app/app.jar"]
