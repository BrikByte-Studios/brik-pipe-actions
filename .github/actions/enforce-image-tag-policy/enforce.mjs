/**
 * Enforce Image Tagging Policy (BrikByteOS v1)
 * ------------------------------------------------------------
 * Purpose:
 * - Prevent non-traceable container pushes.
 * - Enforce immutable SHA tag for all pushes.
 * - Enforce SemVer tag for release pushes.
 * - Forbid 'latest' unless explicitly allowed.
 *
 * Evidence (always written):
 * .audit/PIPE-CONTAINER-BUILD/policy/
 *   ├─ policy-summary.json   (machine readable)
 *   └─ policy-summary.md     (human readable)
 *
 * Outputs:
 * - tags_resolved: normalized + deduped tags (comma-separated)
 * - is_release: true|false
 * - detected_sha_tag: sha-<shortsha> or ""
 * - detected_semver_tag: vX.Y.Z or ""
 * - policy_verdict: pass|fail|warn
 *
 * Notes:
 * - v1 is intentionally strict: SemVer must be vX.Y.Z (no prerelease/build metadata).
 * - SHA canonical format: sha-<shortsha> (7 chars). We accept full SHA tag too,
 *   but the policy evidence will canonicalize to sha-<shortsha>.
 */

import fs from "node:fs";
import path from "node:path";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

function toBool(v) {
  return String(v).toLowerCase() === "true";
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function writeText(p, s) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, s, "utf8");
}

/**
 * Split tags from comma-separated string. Trims whitespace and removes empties.
 */
function parseTags(input) {
  return String(input || "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Deduplicate tags while preserving order.
 */
function dedupe(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * v1 strict SemVer tag: vX.Y.Z
 */
const SEMVER_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Acceptable SHA tags:
 * - sha-<7+ hex>
 * - <fullsha hex 40> (optionally)
 * - <shortsha hex 7+> (optionally, but we prefer sha- prefix)
 */
const SHA_PREFIX_RE = /^sha-([0-9a-f]{7,64})$/i;
const SHA_HEX_RE = /^([0-9a-f]{7,64})$/i;

/**
 * Decide release mode (v1):
 * - explicit input release=true OR
 * - ref is refs/tags/vX.Y.Z
 */
function inferRelease(explicitRelease) {
  if (explicitRelease) return true;
  const ref = env("GITHUB_REF", "");
  if (!ref.startsWith("refs/tags/")) return false;
  const tag = ref.replace("refs/tags/", "");
  return SEMVER_RE.test(tag);
}

/**
 * Find a SemVer tag from tag list (v1 strict).
 */
function detectSemver(tags, semverOverride) {
  if (semverOverride && SEMVER_RE.test(semverOverride)) return semverOverride;
  for (const t of tags) {
    if (SEMVER_RE.test(t)) return t;
  }
  return "";
}

/**
 * Detect sha tag:
 * - Prefer sha-<hex>
 * - If full/short sha appears as raw hex, accept but canonicalize to sha-<shortsha>
 */
function detectShaTag(tags, shaSource) {
  const sha = String(shaSource || "").toLowerCase();
  const short = sha ? sha.slice(0, 7) : "";

  // 1) Prefer explicit sha- tags
  for (const t of tags) {
    const m = t.match(SHA_PREFIX_RE);
    if (m) {
      const hex = m[1].toLowerCase();
      // If shaSource known, ensure it matches prefix (best-effort)
      if (sha && !sha.startsWith(hex) && !hex.startsWith(short)) {
        // mismatch; still allow but record mismatch in reasons later
        return { found: `sha-${hex}`, mismatch: true };
      }
      return { found: `sha-${hex}`, mismatch: false };
    }
  }

  // 2) Accept raw hex tags (short or full)
  for (const t of tags) {
    const m = t.match(SHA_HEX_RE);
    if (m) {
      const hex = m[1].toLowerCase();
      // Canonicalize to sha-<short>
      const canonical = `sha-${hex.slice(0, 7)}`;
      // Validate against shaSource when available
      if (sha && !sha.startsWith(hex) && !sha.startsWith(hex.slice(0, 7))) {
        return { found: canonical, mismatch: true };
      }
      return { found: canonical, mismatch: false };
    }
  }

  // 3) Not found; canonical expected tag
  if (short) return { found: "", expected: `sha-${short}`, mismatch: false };
  return { found: "", expected: "sha-<shortsha>", mismatch: false };
}

/**
 * Write outputs to GITHUB_OUTPUT.
 */
function setOutput(k, v) {
  fs.appendFileSync(env("GITHUB_OUTPUT"), `${k}=${String(v ?? "")}\n`);
}

const push = toBool(env("INPUT_PUSH"));
const allowLatest = toBool(env("INPUT_ALLOW_LATEST", "false"));
const enforce = toBool(env("INPUT_ENFORCE_TAG_POLICY", "true"));

const rawTags = parseTags(env("INPUT_TAGS"));
const tags = dedupe(rawTags);

// Normalize: lowercase 'latest' only (keep others as provided)
const normalized = tags.map((t) => (t.toLowerCase() === "latest" ? "latest" : t));
const tagsResolved = dedupe(normalized);

// Release detection
const explicitRelease = toBool(env("INPUT_RELEASE", "false"));
const isRelease = inferRelease(explicitRelease);

// Source SHA
const sha = (env("INPUT_SHA") || env("GITHUB_SHA", "")).trim();
const detectedSha = detectShaTag(tagsResolved, sha);

// SemVer
const semverOverride = env("INPUT_SEMVER", "").trim();
const detectedSemver = detectSemver(tagsResolved, semverOverride);

const reasons = [];
const notices = [];

// latest policy
const hasLatest = tagsResolved.some((t) => t.toLowerCase() === "latest");
if (hasLatest && !allowLatest) {
  reasons.push({
    code: "LATEST_FORBIDDEN",
    message:
      "Tag 'latest' is forbidden by default. Set allow_latest=true to permit it explicitly.",
    fix: "Remove 'latest' from tags OR set allow_latest=true (explicit).",
  });
}

// push requires SHA
if (push) {
  if (!detectedSha.found) {
    reasons.push({
      code: "SHA_TAG_REQUIRED",
      message:
        "push=true requires an immutable SHA tag for rollback safety and traceability.",
      fix:
        detectedSha.expected
          ? `Add tag '${detectedSha.expected}' to tags.`
          : "Add tag 'sha-<shortsha>' to tags.",
    });
  } else if (detectedSha.mismatch) {
    notices.push({
      code: "SHA_TAG_MISMATCH",
      message:
        "A SHA-like tag was found but does not appear to match the current commit SHA (best-effort check).",
      note: `Detected: ${detectedSha.found}`,
    });
  }
}

// release requires SemVer
if (push && isRelease) {
  if (!detectedSemver) {
    reasons.push({
      code: "SEMVER_REQUIRED_FOR_RELEASE",
      message:
        "Release pushes require a SemVer tag in strict v1 format: vX.Y.Z (no prerelease/build metadata).",
      fix:
        "Add tag 'v<major>.<minor>.<patch>' to tags, e.g. v1.2.3, OR set semver override input.",
    });
  }
}

// verdict
let verdict = reasons.length === 0 ? "pass" : "fail";
if (!enforce && verdict === "fail") verdict = "warn";

// Evidence paths
const evidenceRoot = env("INPUT_EVIDENCE_ROOT", ".audit/PIPE-CONTAINER-BUILD");
const policyDir = path.resolve(evidenceRoot, "policy");
ensureDir(policyDir);

const policyJsonPath = path.join(policyDir, "policy-summary.json");
const policyMdPath = path.join(policyDir, "policy-summary.md");

// Evidence payload (machine readable)
const payload = {
  schema: "brikbyte.audit.container-tag-policy.v1",
  timestamp: new Date().toISOString(),

  inputs: {
    push,
    tags_input: env("INPUT_TAGS"),
    allow_latest: allowLatest,
    release: explicitRelease,
    semver_override: semverOverride || null,
    sha_override: env("INPUT_SHA") ? true : false,
    enforce_tag_policy: enforce,
  },

  detected: {
    is_release: isRelease,
    sha_source: sha ? `${sha.slice(0, 7)}…` : null,
    detected_sha_tag: detectedSha.found || null,
    detected_semver_tag: detectedSemver || null,
    has_latest: hasLatest,
  },

  resolved: {
    tags_resolved: tagsResolved,
  },

  verdict: verdict, // pass|fail|warn
  failure_reasons: reasons,
  notices: notices,
};

// Human readable summary (copy-pasteable)
function md() {
  const lines = [];
  lines.push(`# Container Tag Policy — Summary`);
  lines.push(``);
  lines.push(`- **Verdict:** \`${verdict}\``);
  lines.push(`- **Push:** \`${push}\``);
  lines.push(`- **Release (detected):** \`${isRelease}\``);
  lines.push(`- **Allow latest:** \`${allowLatest}\``);
  lines.push(``);
  lines.push(`## Tags`);
  lines.push(`- **Input:** \`${env("INPUT_TAGS")}\``);
  lines.push(`- **Resolved:** \`${tagsResolved.join(",")}\``);
  lines.push(``);
  lines.push(`## Detected`);
  lines.push(`- **SHA tag:** \`${detectedSha.found || ""}\``);
  lines.push(`- **SemVer tag:** \`${detectedSemver || ""}\``);
  lines.push(`- **Has latest:** \`${hasLatest}\``);
  lines.push(``);

  if (reasons.length) {
    lines.push(`## Failures`);
    for (const r of reasons) {
      lines.push(`- **${r.code}**: ${r.message}`);
      lines.push(`  - Fix: ${r.fix}`);
    }
    lines.push(``);
  }

  if (notices.length) {
    lines.push(`## Notices`);
    for (const n of notices) {
      lines.push(`- **${n.code}**: ${n.message}`);
      if (n.note) lines.push(`  - Note: ${n.note}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

writeJson(policyJsonPath, payload);
writeText(policyMdPath, md());

// Outputs
setOutput("tags_resolved", tagsResolved.join(","));
setOutput("is_release", String(isRelease));
setOutput("detected_sha_tag", detectedSha.found || "");
setOutput("detected_semver_tag", detectedSemver || "");
setOutput("policy_verdict", verdict);

// Fail hard if enforcing and verdict is fail
if (verdict === "fail") {
  // Print clear actionable reasons to logs (no secrets involved)
  console.error("❌ Container image tag policy failed:");
  for (const r of reasons) {
    console.error(`- [${r.code}] ${r.message}`);
    console.error(`  Fix: ${r.fix}`);
  }
  if (!enforce) {
    console.warn("⚠️ enforce_tag_policy=false, continuing with WARN verdict.");
  } else {
    process.exit(1);
  }
}
