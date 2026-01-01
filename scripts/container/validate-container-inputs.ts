/**
 * Validate container build inputs according to Container Build Contract v1.
 *
 * This script is designed to be used by:
 * - reusable workflows (Buildx/Kaniko) before doing any expensive build work
 * - regression tests (PIPE-CORE-1.2.6)
 *
 * It intentionally avoids printing secret values. If keys look secret-like, it fails.
 */
import fs from "node:fs";
import path from "node:path";

type Mode = "dry_run" | "build_only" | "build_and_push";
type Builder = "buildx" | "kaniko";

function fail(msg: string): never {
  console.error(`❌ container-inputs: ${msg}`);
  process.exit(1);
}

function getRequired(name: string): string {
  const v = process.env[name];
  if (!v || String(v).trim().length === 0) fail(`Missing required env: ${name}`);
  return String(v).trim();
}

function parseTags(raw: string): string[] {
  const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length === 0) fail(`tags must contain at least 1 tag`);
  return tags;
}

function assertNoSecretsInBuildArgs(raw: string) {
  // Basic heuristic. You can harden later.
  const forbidden = ["TOKEN", "PASSWORD", "SECRET", "KEY", "CREDENTIAL"];
  for (const line of raw.split("\n")) {
    const k = line.split("=")[0]?.trim() || "";
    if (!k) continue;
    const upper = k.toUpperCase();
    if (forbidden.some((f) => upper.includes(f))) {
      fail(`build_args contains secret-like key "${k}". Use OIDC/registry auth, not build args.`);
    }
    if (line.includes("\r") || line.includes("\0")) fail("build_args contains invalid control characters");
  }
}

const builder = getRequired("BUILDER") as Builder;
const mode = getRequired("MODE") as Mode;
const context = getRequired("CONTEXT");
const dockerfile = getRequired("DOCKERFILE");
const imageName = getRequired("IMAGE_NAME");
const registry = getRequired("REGISTRY");
const tagsRaw = getRequired("TAGS");
const tags = parseTags(tagsRaw);

if (!["buildx", "kaniko"].includes(builder)) fail(`builder must be buildx|kaniko (got "${builder}")`);
if (!["dry_run", "build_only", "build_and_push"].includes(mode)) fail(`mode invalid (got "${mode}")`);

// Existence checks (dry-run must validate)
const ctxPath = path.resolve(process.cwd(), context);
if (!fs.existsSync(ctxPath)) fail(`context not found: ${context}`);

const dfPath = path.resolve(process.cwd(), context, dockerfile);
if (!fs.existsSync(dfPath)) fail(`dockerfile not found: ${path.join(context, dockerfile)}`);

// Minimal image name rules (no registry prefix inside image_name)
if (imageName.includes("://") || imageName.includes("ghcr.io") || imageName.includes("/")) {
  // NOTE: You may allow org/repo forms; keep minimal now:
  // If you want org/repo, remove this condition. For v1: enforce org/repo style by policy (later).
}
if (imageName.startsWith("/") || imageName.endsWith("/")) fail("image_name cannot start/end with '/'");

// Mode → push expectation
const push = process.env.PUSH ? process.env.PUSH === "true" : mode === "build_and_push";
if (mode === "build_and_push" && !push) fail("mode=build_and_push requires push=true");

// SHA tag enforcement baseline (policy gate will harden formats)
if (mode === "build_and_push") {
  const hasSha = tags.some((t) => t.startsWith("sha-") || /^[a-f0-9]{7,40}$/i.test(t));
  if (!hasSha) fail("build_and_push requires an immutable SHA tag (e.g. sha-<shortsha> or full sha).");
}

const buildArgs = process.env.BUILD_ARGS || "";
if (buildArgs.trim().length > 0) assertNoSecretsInBuildArgs(buildArgs);

console.log("✅ container-inputs: OK");
console.log(
  JSON.stringify(
    {
      builder,
      mode,
      context,
      dockerfile,
      imageName,
      registry,
      tags,
      push
    },
    null,
    2
  )
);
