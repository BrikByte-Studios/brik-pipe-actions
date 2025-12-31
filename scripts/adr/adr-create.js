#!/usr/bin/env node
/**
 * BrikByte Studios — ADR Create Script (GOV-ADR-TOOLS-001)
 *
 * Generates ADRs using the FULL canonical template defined by governance.
 *
 * This script:
 *   ✓ Computes seq (NNN)
 *   ✓ Computes id (ADR-000X)
 *   ✓ Creates filename: NNN-slug.md
 *   ✓ Fills canonical YAML front-matter EXACTLY per the governance template
 *   ✓ Fills the full ADR body template used by GOV-ADR-005
 */

const fs = require("fs");
const path = require("path");

// -------- CLI ARG PARSER ----------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[key] = val;
  }
  return args;
}

// -------- HELPERS ------------------------------------------------------------

function todayISO() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findExistingAdrs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{3}-.*\.md$/.test(f));
}

function computeNextSeq(files) {
  if (!files.length) return 1;
  let max = 0;
  for (const f of files) {
    const n = parseInt(f.slice(0, 3), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// -------- TEMPLATE GENERATION ------------------------------------------------

function renderFrontMatter({ id, seq, title, status, date, review_after, authors, area }) {
  const authorsYaml = authors.map((a) => `  - "${a}"`).join("\n") || `  - "@unknown"`;
  const areaYaml = area.map((a) => `  - "${a}"`).join("\n") || `  - "PIPE"`;

  return `---
id: "${id}"                # e.g. ADR-0003 (4-digit padded)
seq: ${seq}                        # integer, matches filename prefix
title: "${title}"
status: "${status}"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: ${date}              # YYYY-MM-DD
review_after: ${review_after}

authors:
${authorsYaml}

area:
${areaYaml}

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---
`;
}

function renderBody({ title, status, date, review_after, authors, area }) {
  return `
# ${title}

## Status

- **Status:** ${status}
- **Date:** ${date}
- **Review After:** ${review_after || "n/a"}
- **Authors:** ${authors.join(", ")}
- **Area:** ${area.join(", ")}
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

Describe **why** this decision is needed.

Include:

- The problem statement  
- Architectural or organizational constraints  
- Relevant background  
- What changed to make this decision necessary *now*  
- Links to RFCs, incidents, or technical debt items if relevant

---

## 2. Decision

State the decision **clearly and unambiguously**.

Examples:

- “We will adopt GitHub Rulesets for branch protection.”  
- “We will standardize on Terraform + Helm for IaC.”  

Include rationale:

- Trade-offs  
- Why this option was selected  
- Supporting data  
- Alignment with BrikByte architecture principles  

---

## 3. Alternatives Considered

Below are the options evaluated.

At least **one rejected** and **one chosen** option are required.

---

### 3.1 Option A — <Name A>
**Pros:**  
- …

**Cons:**  
- …

**Why Rejected:**  
- …

---

### 3.2 Option B — <Name B>
**Pros:**  
- …

**Cons:**  
- …

**Why Rejected:**  
- …

---

### 3.3 Option C — <Name C>
**Pros:**  
- …

**Cons:**  
- …

**Why Rejected:**  
- …

---

### 3.4 **Option D — <Chosen Option> (✔ Chosen)**
**Pros:**  
- Strong alignment with governance  
- Improves maintainability  
- Reduces long-term risk  

**Cons / Trade-offs:**  
- Requires onboarding / process updates  

**Why Accepted:**  
- Best balance of governance alignment and developer experience.  
- Enables traceable, reviewable decision history.  

---

## 4. Consequences

### Positive
- Standardization  
- Governance alignment  
- Reduced long-term complexity  

### Negative / Risks
- Migration cost  
- Training required  
- Possible breakage in older components  

### Mitigations
- Training plan  
- Progressive rollout  
- Compatibility plan  

---

## 5. Implementation Notes

> Important details about rollout, migration, compatibility, or ownership.

---

## 6. References

- https://example.com
`.trimStart();
}

// -------- MAIN --------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  const root = path.resolve(__dirname, "../..");
  const adrDir = path.join(root, args.dir || "docs/adr");

  const title = args.title || "Untitled ADR";
  const status = args.status || "Proposed";
  const authors = (args.author || "@unknown").split(",").map((s) => s.trim());
  const area = (args.area || "PIPE").split(",").map((s) => s.trim());
  const review_after = args.review_after || null;

  if (!fs.existsSync(adrDir)) fs.mkdirSync(adrDir, { recursive: true });

  const existing = findExistingAdrs(adrDir);
  const seq = computeNextSeq(existing);
  const seqPadded = String(seq).padStart(3, "0");
  const idPadded = String(seq).padStart(4, "0");

  const id = `ADR-${idPadded}`;
  const date = todayISO();
  const slug = slugify(title);
  const filename = `${seqPadded}-${slug}.md`;
  const filepath = path.join(adrDir, filename);

  if (fs.existsSync(filepath)) {
    console.error(`❌ File already exists: ${filepath}`);
    process.exit(1);
  }

  const fm = renderFrontMatter({
    id,
    seq,
    title,
    status,
    date,
    review_after,
    authors,
    area
  });

  const body = renderBody({
    title,
    status,
    date,
    review_after,
    authors,
    area
  });

  fs.writeFileSync(filepath, `${fm}\n${body}\n`, "utf8");

  console.log(`✅ Created ADR`);
  console.log(`   File: ${filepath}`);
  console.log(`   ID:   ${id}`);
  console.log(`   Seq:  ${seq}`);
}

main();
