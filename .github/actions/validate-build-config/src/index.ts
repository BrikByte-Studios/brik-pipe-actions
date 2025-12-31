/**
 * BrikByteOS — validate-build-config action
 *
 * Purpose
 *   Validate `.brik/build.yml` against:
 *     1) JSON Schema (shape + basic types)
 *     2) Runtime matrix constraints (supported stack/tools/versions)
 *     3) Cross-field rules (tool allowed for stack, command/flag coherence, etc.)
 *
 * Guarantees
 *   - Fail-fast (<5s): local filesystem only, no network calls
 *   - Human-readable errors: exact path + expected vs actual + suggestion
 *   - Evidence on pass AND fail (written before exiting)
 *
 * Evidence output (always):
 *   .audit/PIPE-BUILD/validation/
 *     build-config.raw.yml
 *     build-config.resolved.json
 *     validation-report.json
 *     validation-summary.md
 *
 * Implementation notes
 *   - This is bundled with ncc (dist/index.js) for zero-install CI usage.
 *   - We avoid relying solely on GITHUB_ACTION_PATH.
 *     Instead, we locate the action directory via __dirname (bundled CJS),
 *     then walk up to repo root to read docs/pipelines/runtime-matrix.yml and schemas.
 */

import * as core from "@actions/core";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

type Stack = "node" | "python" | "java" | "dotnet" | "go";

type ValidationIssue = {
  level: "error" | "warning";
  code: string;
  path: string;
  message: string;
  suggestion?: string;
};

type ValidationReport = {
  ok: boolean;
  strict: boolean;
  schemaVersion: number | null;
  stack: Stack | null;
  files: {
    configPath: string;
    schemaPath: string;
    runtimeMatrixPath: string;
    evidenceDir: string;
  };
  issues: ValidationIssue[];
  timingsMs: {
    total: number;
    schema: number;
    rules: number;
    io: number;
  };
};

function nowMs() {
  return Date.now();
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

function readFile(p: string) {
  return fs.readFileSync(p, "utf8");
}

function detectUnsafePattern(cmd: string): boolean {
  const s = cmd.toLowerCase();
  // v1: ban common failure-hiding patterns.
  return (
    s.includes("|| true") ||
    s.includes("||:") ||
    s.includes("; true") ||
    s.includes("exit 0") ||
    s.includes("set +e")
  );
}

/**
 * Determine brik-pipe-actions repo root when bundled.
 * dist/index.js lives at:
 *   .github/actions/validate-build-config/dist/index.js
 * repo root is 4 levels up from dist:
 *   dist -> validate-build-config -> actions -> .github -> repoRoot
 */
function resolveActionRepoRoot(): string {
  return path.resolve(__dirname, "../../..", ".."); // careful: dist -> action -> actions -> .github -> root
}

/**
 * Loads runtime matrix from brik-pipe-actions repo.
 */
function loadRuntimeMatrix(repoRoot: string): any {
  const candidates = [
    path.join(repoRoot, "docs", "pipelines", "runtime-matrix.yml"),
    path.join(repoRoot, "internal", "vendor", "runtime-matrix.yml"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p))return { path: p, data: yaml.load(readFile(p)) as any };
  }

  throw new Error(`runtime-matrix.yml not found. Tried:\n- ${candidates.join("\n- ")}`);
}

/**
 * Loads JSON schema from brik-pipe-actions repo.
 */
function loadSchema(repoRoot: string): any {
  const p = path.join(repoRoot, "schemas", "build.schema.json");
  if (!fs.existsSync(p)) throw new Error(`build.schema.json not found at: ${p}`);
  return { path: p, data: JSON.parse(readFile(p)) };
}

function stackToolAllowlist(): Record<Stack, Set<string>> {
  return {
    node: new Set(["npm", "pnpm", "yarn"]),
    python: new Set(["pip", "poetry"]),
    java: new Set(["maven", "gradle"]),
    dotnet: new Set(["dotnet"]),
    go: new Set(["go"]),
  };
}

/**
 * v1 default commands (contract-aligned).
 * These are injected only when config omits them.
 */
function defaultsByStack(stack: Stack, toolKind: string) {
  switch (stack) {
    case "node":
      return {
        install: toolKind === "pnpm" ? "pnpm install --frozen-lockfile" :
                 toolKind === "yarn" ? "yarn install --frozen-lockfile" :
                 "npm ci",
        lint: "npm run lint",
        test: "npm test",
        build: "npm run build",
        artifacts: ["dist/**"],
      };
    case "python":
      return {
        install: toolKind === "poetry" ? "poetry install --no-interaction --no-ansi" : "python -m pip install -r requirements.txt",
        lint: "python -m ruff check .",
        test: "python -m pytest -q",
        build: "python -m compileall .",
        artifacts: ["__pycache__/**"],
      };
    case "java":
      return {
        install: toolKind === "gradle" ? "./gradlew dependencies" : "mvn -q -DskipTests dependency:resolve",
        lint: toolKind === "gradle" ? "./gradlew check" : "mvn -q -DskipTests verify",
        test: toolKind === "gradle" ? "./gradlew test" : "mvn test",
        build: toolKind === "gradle" ? "./gradlew build" : "mvn -DskipTests package",
        artifacts: ["target/**", "build/**"],
      };
    case "dotnet":
      return {
        install: "dotnet restore",
        lint: "",
        test: "dotnet test",
        build: "dotnet build -c Release",
        artifacts: ["bin/**", "obj/**"],
      };
    case "go":
      return {
        install: "go mod download",
        lint: "",
        test: "go test ./...",
        build: "go build ./...",
        artifacts: ["bin/**"],
      };
  }
}

/**
 * Resolve matrix stack entry.
 */
function findMatrixStack(matrix: any, stack: Stack): any {
  const stacks = matrix?.stacks ?? [];
  const entry = stacks.find((s: any) => s?.runtime?.name === stack);
  if (!entry) throw new Error(`runtime "${stack}" not found in matrix.stacks`);
  return entry;
}

/**
 * Version enforcement (v1 pragmatic):
 * - If matrix specifies supportedVersions, the config version MUST match one.
 * - Otherwise, accept the version (matrix still supplies defaults).
 */
function isVersionAllowed(matrixStack: any, version: string): { ok: boolean; hint?: string } {
  const allowed: string[] = matrixStack?.supportedVersions ?? matrixStack?.allowedVersions ?? [];
  if (!Array.isArray(allowed) || allowed.length === 0) return { ok: true };

  const ok = allowed.includes(version);
  return {
    ok,
    hint: ok ? undefined : `Allowed versions: ${allowed.join(", ")}`,
  };
}

/**
 * Build resolved config that workflows can rely on later.
 */
function resolveConfig(raw: any, matrix: any): any {
  const stack = raw.stack as Stack;
  const matrixStack = findMatrixStack(matrix, stack);

  const workingDirectory = raw.workingDirectory || ".";
  const runtimeVersion = raw?.runtime?.version || String(matrixStack.defaultVersion || "");
  const toolKind =
    raw?.tool?.kind ||
    String(matrixStack?.toolchain?.packageManagers?.default || matrixStack?.toolchain?.buildTools?.default || "");

  const flags = {
    runLint: Boolean(raw?.flags?.runLint ?? false),
    runTests: Boolean(raw?.flags?.runTests ?? true),
  };

  const defaults = defaultsByStack(stack, toolKind);

  const commands = {
    install: (raw?.commands?.install || defaults.install || "").trim(),
    lint: (raw?.commands?.lint || defaults.lint || "").trim(),
    test: (raw?.commands?.test || defaults.test || "").trim(),
    build: (raw?.commands?.build || defaults.build || "").trim(),
  };

  const artifacts = {
    paths:
      Array.isArray(raw?.artifacts?.paths) && raw.artifacts.paths.length > 0
        ? raw.artifacts.paths
        : defaults.artifacts,
  };

  return {
    schemaVersion: raw.schemaVersion,
    stack,
    workingDirectory,
    runtime: { version: runtimeVersion },
    tool: { kind: toolKind },
    flags,
    commands,
    artifacts,
  };
}

function formatAjvErrors(errors: any[]): ValidationIssue[] {
  return (errors || []).map((e) => {
    const pathStr = e.instancePath || "(root)";
    const expected = e.message || "invalid value";
    const suggestion = e.keyword === "enum" ? "Choose one of the allowed values." : undefined;

    return {
      level: "error",
      code: `SCHEMA_${String(e.keyword || "INVALID").toUpperCase()}`,
      path: pathStr,
      message: expected,
      suggestion,
    };
  });
}

function makeSummaryMd(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`# Build Config Validation`);
  lines.push(`- Result: **${report.ok ? "PASS" : "FAIL"}**`);
  lines.push(`- Strict: **${report.strict ? "true" : "false"}**`);
  lines.push(`- Stack: **${report.stack ?? "unknown"}**`);
  lines.push(`- SchemaVersion: **${report.schemaVersion ?? "unknown"}**`);
  lines.push(``);
  lines.push(`## Files`);
  lines.push(`- Config: \`${report.files.configPath}\``);
  lines.push(`- Schema: \`${report.files.schemaPath}\``);
  lines.push(`- Runtime matrix: \`${report.files.runtimeMatrixPath}\``);
  lines.push(`- Evidence dir: \`${report.files.evidenceDir}\``);
  lines.push(``);
  lines.push(`## Issues`);
  if (report.issues.length === 0) {
    lines.push(`- None ✅`);
  } else {
    for (const issue of report.issues) {
      lines.push(`- **${issue.level.toUpperCase()}** \`${issue.code}\` at \`${issue.path}\`: ${issue.message}`);
      if (issue.suggestion) lines.push(`  - Suggestion: ${issue.suggestion}`);
    }
  }
  lines.push(``);
  lines.push(`## Timing (ms)`);
  lines.push(`- total: ${report.timingsMs.total}`);
  lines.push(`- schema: ${report.timingsMs.schema}`);
  lines.push(`- rules: ${report.timingsMs.rules}`);
  lines.push(`- io: ${report.timingsMs.io}`);
  lines.push(``);
  return lines.join("\n");
}

async function main() {
  const t0 = nowMs();

  const configPath = core.getInput("config_path") || ".brik/build.yml";
  const strict = (core.getInput("strict") || "false").toLowerCase() === "true";
  const allowUnsafe = (core.getInput("allow_unsafe_commands") || "false").toLowerCase() === "true";

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const absConfigPath = path.join(workspace, configPath);

  const evidenceDir = path.join(workspace, ".audit", "PIPE-BUILD", "validation");
  ensureDir(evidenceDir);

  const ioStart = nowMs();

  if (!fs.existsSync(absConfigPath)) {
    // Write minimal evidence and fail.
    const report: ValidationReport = {
      ok: false,
      strict,
      schemaVersion: null,
      stack: null,
      files: {
        configPath: absConfigPath,
        schemaPath: "(unknown)",
        runtimeMatrixPath: "(unknown)",
        evidenceDir,
      },
      issues: [
        {
          level: "error",
          code: "CONFIG_NOT_FOUND",
          path: configPath,
          message: `.brik/build.yml not found`,
          suggestion: `Create ${configPath} using docs/pipelines/build-config.md templates.`,
        },
      ],
      timingsMs: { total: nowMs() - t0, schema: 0, rules: 0, io: nowMs() - ioStart },
    };

    writeFile(path.join(evidenceDir, "validation-report.json"), JSON.stringify(report, null, 2));
    writeFile(path.join(evidenceDir, "validation-summary.md"), makeSummaryMd(report));
    core.setOutput("validation_ok", "false");
    core.setOutput("validation_report_path", path.join(evidenceDir, "validation-report.json"));
    throw new Error("Build config missing: .brik/build.yml");
  }

  const rawYaml = readFile(absConfigPath);
  writeFile(path.join(evidenceDir, "build-config.raw.yml"), rawYaml);

  const rawConfig = yaml.load(rawYaml) as any;

  const repoRoot = resolveActionRepoRoot();
  const runtimeMatrix = loadRuntimeMatrix(repoRoot);
  const schema = loadSchema(repoRoot);

  const ioMs = nowMs() - ioStart;

  const schemaStart = nowMs();

  // AJV schema validation
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv);

  const validate = ajv.compile(schema.data);
  const schemaOk = validate(rawConfig) as boolean;

  const issues: ValidationIssue[] = [];
  if (!schemaOk) issues.push(...formatAjvErrors(validate.errors || []));

  const schemaMs = nowMs() - schemaStart;

  const rulesStart = nowMs();

  // If schema failed, we still attempt to produce a resolved config “best effort” for evidence.
  const stack = rawConfig?.stack as Stack | undefined;

  // Cross-field rules only if stack is known enough
  if (stack && ["node", "python", "java", "dotnet", "go"].includes(stack)) {
    const matrixStack = findMatrixStack(runtimeMatrix.data, stack);

    // Tool allowlist by stack
    const tool = String(rawConfig?.tool?.kind || matrixStack?.toolchain?.packageManagers?.default || "");
    const allowedTools = stackToolAllowlist()[stack];

    if (!tool || !allowedTools.has(tool)) {
      issues.push({
        level: "error",
        code: "TOOL_NOT_ALLOWED",
        path: "/tool/kind",
        message: `Tool "${tool || "(missing)"}" is not allowed for stack "${stack}"`,
        suggestion: `Choose one of: ${Array.from(allowedTools).join(", ")}`,
      });
    }

    // Runtime version allowed by matrix (if matrix provides allowlist)
    const runtimeVersion = String(rawConfig?.runtime?.version || matrixStack.defaultVersion || "");
    if (!runtimeVersion) {
      issues.push({
        level: "error",
        code: "RUNTIME_VERSION_MISSING",
        path: "/runtime/version",
        message: `Runtime version could not be resolved (missing in config and matrix defaultVersion)`,
        suggestion: `Set runtime.version in .brik/build.yml OR fix docs/pipelines/runtime-matrix.yml defaultVersion.`,
      });
    } else {
      const allowed = isVersionAllowed(matrixStack, runtimeVersion);
      if (!allowed.ok) {
        issues.push({
          level: "error",
          code: "RUNTIME_VERSION_NOT_ALLOWED",
          path: "/runtime/version",
          message: `Runtime version "${runtimeVersion}" is not allowed for stack "${stack}"`,
          suggestion: allowed.hint,
        });
      }
    }

    // Flags + commands coherence
    const runTests = Boolean(rawConfig?.flags?.runTests ?? true);
    const runLint = Boolean(rawConfig?.flags?.runLint ?? false);

    const cmdTest = String(rawConfig?.commands?.test || "").trim();
    const cmdLint = String(rawConfig?.commands?.lint || "").trim();
    const cmdBuild = String(rawConfig?.commands?.build || "").trim();

    if (runTests === false && cmdTest) {
      issues.push({
        level: "warning",
        code: "TEST_CMD_IGNORED",
        path: "/commands/test",
        message: `flags.runTests=false but commands.test is set (it will be ignored)`,
        suggestion: `Remove commands.test or set flags.runTests=true.`,
      });
    }
    if (runLint === false && cmdLint) {
      issues.push({
        level: "warning",
        code: "LINT_CMD_IGNORED",
        path: "/commands/lint",
        message: `flags.runLint=false but commands.lint is set (it will be ignored)`,
        suggestion: `Remove commands.lint or set flags.runLint=true.`,
      });
    }

    // Build command must exist after resolution (v1: required)
    // We enforce “build exists” at the resolved level to avoid false negatives.
    // (Resolution occurs below and injects defaults.)
    // Unsafe command patterns
    const allCmds = [rawConfig?.commands?.install, rawConfig?.commands?.lint, rawConfig?.commands?.test, rawConfig?.commands?.build]
      .filter(Boolean)
      .map((x: any) => String(x));

    if (!allowUnsafe) {
      for (const cmd of allCmds) {
        if (detectUnsafePattern(cmd)) {
          issues.push({
            level: "error",
            code: "UNSAFE_COMMAND_PATTERN",
            path: "/commands",
            message: `Command contains a failure-hiding pattern (e.g. "|| true", "exit 0", "set +e")`,
            suggestion: `Remove the pattern. BrikByte build contract forbids hiding failures in v1.`,
          });
          break;
        }
      }
    }
  }

  const resolved = (() => {
    try {
      if (!stack) return { note: "could not resolve (stack missing)", raw: rawConfig };
      return resolveConfig(rawConfig, runtimeMatrix.data);
    } catch (e: any) {
      return { note: "resolution failed", error: String(e?.message || e), raw: rawConfig };
    }
  })();

  // Enforce "build command exists" after resolution (if stack present)
  if (stack && (resolved as any)?.commands) {
    const b = String((resolved as any).commands.build || "").trim();
    if (!b) {
      issues.push({
        level: "error",
        code: "BUILD_COMMAND_MISSING",
        path: "/commands/build",
        message: `Build command resolved to empty (build is mandatory in v1 contract)`,
        suggestion: `Set commands.build OR ensure stack defaults provide build command.`,
      });
    }
  }

  const rulesMs = nowMs() - rulesStart;

  // Strict mode: warnings become errors
  const finalIssues: ValidationIssue[] = strict
    ? issues.map((i) =>
        i.level === "warning"
            ? { ...i, level: "error" as const, code: `STRICT_${i.code}` }
            : i
        )
    : issues;


  const ok = finalIssues.every((i) => i.level !== "error");

  const report: ValidationReport = {
    ok,
    strict,
    schemaVersion: typeof rawConfig?.schemaVersion === "number" ? rawConfig.schemaVersion : null,
    stack: (rawConfig?.stack as Stack) || null,
    files: {
      configPath: absConfigPath,
      schemaPath: schema.path,
      runtimeMatrixPath: runtimeMatrix.path,
      evidenceDir,
    },
    issues: finalIssues,
    timingsMs: {
      total: nowMs() - t0,
      schema: schemaMs,
      rules: rulesMs,
      io: ioMs,
    },
  };

  // Evidence (always)
  writeFile(path.join(evidenceDir, "build-config.resolved.json"), JSON.stringify(resolved, null, 2));
  writeFile(path.join(evidenceDir, "validation-report.json"), JSON.stringify(report, null, 2));
  writeFile(path.join(evidenceDir, "validation-summary.md"), makeSummaryMd(report));

  // Outputs
  core.setOutput("validation_ok", ok ? "true" : "false");
  core.setOutput("resolved_config_path", path.join(evidenceDir, "build-config.resolved.json"));
  core.setOutput("validation_report_path", path.join(evidenceDir, "validation-report.json"));

  if (!ok) {
    // Fail the step, but evidence is already written.
    throw new Error(`Invalid build config: see ${path.join(".audit", "PIPE-BUILD", "validation", "validation-summary.md")}`);
  }
}

main().catch((err: any) => {
  core.setFailed(err?.message ?? String(err));
});
