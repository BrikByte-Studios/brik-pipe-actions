#!/usr/bin/env node
/**
 * BrikByte Studios — ADR Linter (GOV-ADR-TOOLS-001)
 *
 * Responsibilities:
 *  - Read ADR Markdown files matching a glob (e.g. docs/adr/[0-9][0-9][0-9]-*.md)
 *  - Extract YAML front-matter and parse it into a JS object
 *  - Validate the front-matter against docs/adr/adr.schema.json (JSON Schema)
 *  - Enforce additional invariants:
 *      * id and seq must be unique across all ADRs
 *      * filename prefix must match seq
 *  - Emit GitHub Actions annotations for any violations
 *  - Exit with non-zero code if any errors are found
 *
 * Usage:
 *   node scripts/adr/adr-lint.js --glob "docs/adr/[0-9][0-9][0-9]-*.md" --schema "docs/adr/adr.schema.json"
 */

const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");
const yaml = require("yaml");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

/**
 * Very small CLI arg parser.
 * Accepts flags like: --glob value --schema value
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

/**
 * Emit a GitHub Actions error annotation.
 *
 * See: https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
 *
 * @param {Object} opts
 * @param {string} opts.file - file path relative to repo root
 * @param {number} [opts.line] - 1-based line number
 * @param {string} opts.message - error message
 */
function ghError({ file, line, message }) {
  const linePart = line ? `,line=${line}` : "";
  // Note: message must be escaped for newlines, we'll keep it simple here.
  console.error(`::error file=${file}${linePart}::${message}`);
}

/**
 * Load and parse JSON Schema from the given path.
 */
function loadSchema(schemaPath) {
  const raw = fs.readFileSync(schemaPath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Extract YAML front-matter from a Markdown file.
 *
 * Expects a format like:
 *
 * ---
 * key: value
 * ...
 * ---
 * # Markdown content...
 *
 * Returns:
 *   { frontMatter: object, frontMatterText: string, contentStartLine: number }
 *
 * contentStartLine is 1-based line where markdown content begins.
 */
function extractFrontMatter(raw, filePath) {
  const lines = raw.split(/\r?\n/);

  if (lines[0].trim() !== "---") {
    throw new Error(
      `File "${filePath}" does not start with '---'; ADRs must begin with YAML front-matter.`
    );
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error(
      `File "${filePath}" has an opening '---' but no closing '---' for YAML front-matter.`
    );
  }

  const frontMatterLines = lines.slice(1, endIndex);
  const frontMatterText = frontMatterLines.join("\n");
  const contentStartLine = endIndex + 2; // +1 to move past '---', +1 for 1-based

  let frontMatter;
  try {
    frontMatter = yaml.parse(frontMatterText) || {};
  } catch (err) {
    throw new Error(
      `YAML parsing error in "${filePath}" front-matter: ${err.message}`
    );
  }

  return { frontMatter, frontMatterText, contentStartLine };
}

/**
 * Validate a single ADR front-matter object using Ajv.
 *
 * @param {object} validate - Ajv validate function
 * @param {object} frontMatter - parsed front-matter object
 * @param {string} filePath - ADR file path
 * @returns {Array<{message: string}>} list of validation errors
 */
function validateFrontMatterSchema(validate, frontMatter, filePath) {
  const ok = validate(frontMatter);
  if (ok) return [];

  return (validate.errors || []).map((err) => {
    const instancePath = err.instancePath || "";
    const property = instancePath ? instancePath.replace(/^\//, "") : "(root)";
    const message = `Schema validation error in "${filePath}" at "${property}": ${err.message}`;
    return { message };
  });
}

/**
 * Extract numeric seq from filename prefix (first 3 digits).
 *
 * e.g. docs/adr/001-my-decision.md -> 1
 */
function extractSeqFromFilename(filePath) {
  const base = path.basename(filePath);
  const match = /^(\d{3})-/.exec(base);
  if (!match) return null;
  return parseInt(match[1], 10);
}

/**
 * Main entry point.
 */
async function main() {
  const args = parseArgs(process.argv);
  const globPattern =
    args.glob || "docs/adr/[0-9][0-9][0-9]-*.md";
  const schemaPath =
    args.schema || "docs/adr/adr.schema.json";

  if (!fs.existsSync(schemaPath)) {
    console.error(
      `ADR schema not found at "${schemaPath}". Ensure docs/adr/adr.schema.json exists.`
    );
    process.exit(1);
  }

  const files = globSync(globPattern, { nodir: true });

  if (files.length === 0) {
    console.log(
      `No ADR files found for glob "${globPattern}". Nothing to validate.`
    );
    process.exit(0);
  }

  // Setup Ajv
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = loadSchema(schemaPath);
  const validate = ajv.compile(schema);

  let errorCount = 0;
  const ids = new Map();
  const seqs = new Map();

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");

    let frontMatter;
    try {
      ({ frontMatter } = extractFrontMatter(raw, file));
    } catch (err) {
      errorCount++;
      ghError({
        file,
        line: 1,
        message: err.message,
      });
      continue;
    }

    // Schema validation
    const schemaErrors = validateFrontMatterSchema(
      validate,
      frontMatter,
      file
    );
    if (schemaErrors.length > 0) {
      for (const e of schemaErrors) {
        errorCount++;
        ghError({
          file,
          line: 1,
          message: e.message,
        });
      }
      continue; // No need to run extra checks if schema already fails
    }

    // Additional invariants: id & seq uniqueness; filename ↔ seq match.
    const id = frontMatter.id;
    const seq = frontMatter.seq;

    if (id) {
      if (ids.has(id)) {
        errorCount++;
        ghError({
          file,
          line: 1,
          message: `Duplicate ADR id "${id}". Also seen in "${ids.get(
            id
          )}".`,
        });
      } else {
        ids.set(id, file);
      }
    }

    if (typeof seq === "number") {
      if (seqs.has(seq)) {
        errorCount++;
        ghError({
          file,
          line: 1,
          message: `Duplicate ADR seq "${seq}". Also seen in "${seqs.get(
            seq
          )}".`,
        });
      } else {
        seqs.set(seq, file);
      }

      const fileSeq = extractSeqFromFilename(file);
      if (fileSeq !== null && fileSeq !== seq) {
        errorCount++;
        ghError({
          file,
          line: 1,
          message: `Filename prefix (${fileSeq}) does not match seq (${seq}). Filenames must be of the form "00X-title.md" where X = seq.`,
        });
      }
    }
  }

  if (errorCount > 0) {
    console.error(
      `ADR linting failed: ${errorCount} violation(s) found across ${files.length} file(s).`
    );
    process.exit(1);
  }

  console.log(
    `ADR linting succeeded: ${files.length} ADR file(s) validated successfully.`
  );
  process.exit(0);
}

main().catch((err) => {
  // Ensure we don't crash without annotation
  ghError({
    file: "scripts/adr/adr-lint.js",
    message: `Unexpected error: ${err.message}`,
  });
  process.exit(1);
});
