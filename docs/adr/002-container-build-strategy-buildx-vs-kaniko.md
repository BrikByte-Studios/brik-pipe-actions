---
id: "ADR-0002"                # e.g. ADR-0003 (4-digit padded)
seq: 2                        # integer, matches filename prefix
title: "Container Build Strategy (Buildx vs Kaniko)"
status: "Proposed"            # Proposed | Accepted | Superseded | Rejected | Deprecated
date: 2026-01-01              # YYYY-MM-DD
review_after: 2026-03-01

authors:
  - "Platform Lead"
  - "BrikByte Studios"

area:
  - "pipelines/containers/security"

rfc: null                     # Optional, e.g. "RFC-0007"

supersedes: []                # ADR IDs superseded by this one
superseded_by: null           # ADR that replaces this one

links:
  - type: "doc"
    label: "Design doc"
    url: "https://example.com/design-doc"
---

# Container Build Strategy (Buildx vs Kaniko)

## Status

- **Status:** Proposed
- **Date:** 2026-01-01
- **Review After:** 2026-03-01
- **Authors:** Platform Lead, BrikByte Studios
- **Area:** pipelines/containers/security
- **Supersedes:** none
- **Superseded By:** none

---

## 1. Context

BrikByteOS Pipelines v1 introduces container images as a first-class deployment artifact.
However, current container builds across repositories are inconsistent, insecure, and not auditable:

- Some repos rely on privileged Docker daemon builds
- Others require daemonless environments
- Tagging policies are inconsistent
- No standard provenance or audit evidence exists
- Caching behavior varies and introduces risk of stale or poisoned layers

At the same time, BrikByteOS is expanding into locked-down runner environments where **Docker-in-Docker is forbidden**, making a single-tool strategy infeasible.

A canonical build contract is therefore required to ensure:

- All container images are reproducible
- All images are traceable to source code
- All builds emit governance evidence
- Builds can function in both privileged and restricted environments

---

## 2. Decision

We adopt a **dual-engine canonical container build strategy**:

| Builder |	Role |
| --- | --- |
| Docker Buildx	| Default for trusted / privileged runners |
| Kaniko | Mandatory for daemonless / restricted runners |

All container builds MUST comply with the **Container Build Contract v1**, which defines:
- Unified workflow interface
- Tagging policy
- Caching rules
- Registry authentication contract
- Evidence emission contract (.audit/PIPE-IMAGE)
- Security constraints

This strategy ensures reproducibility, governance compliance, and environmental portability.

---

## 3. Alternatives Considered

### 3.1 Option A — Docker-Only Builds
**Pros:**  
- Fast
- Familiar tooling

**Cons:**  
- Requires privileged runners
- Not allowed in hardened environments
- High breach risk

**Why Rejected:**  
- Fails security and portability requirements.

---

### 3.2 Option B — Kaniko-Only Builds
**Pros:**  
- Secure
- Daemonless

**Cons:**  
- Slower builds
- Less flexible caching
- Limited local testing support

**Why Rejected:**  
- Penalizes performance where Buildx is allowed.

---

### 3.3 Option C — Repo-Defined Builder
**Pros:**  
- Flexible

**Cons:**  
- Fragmented governance
- Inconsistent audit posture
- Impossible to enforce policy

**Why Rejected:**  
- Violates BrikByte governance model.

---

### 3.4 **Option D — Dual Engine Strategy (✔ Chosen)**
**Pros:**  
- Secure in restricted environments
- Fast in privileged environments
- Enforceable governance
- Compatible with all tenants

**Cons / Trade-offs:**  
- Requires onboarding education
- Slight complexity increase  

**Why Accepted:**  
- Best balance between security, DX, performance and governance. 

---

## 4. Consequences

### Positive
- Standardized container builds
- Immutable SHA-based rollback safety
- Centralized audit evidence
- Governance-grade traceability

### Negative / Risks
- Initial onboarding friction
- Slight pipeline complexity

### Mitigations
- Opinionated scaffolds
- Copy-pasteable workflows
- Dry-run validation mode

---

## 5. Implementation Notes

- Build interface defined in PIPE-CORE-1.2.1
- Evidence MUST always emit `.audit/PIPE-IMAGE/*`
- Tagging policy enforced by PIPE-CORE-1.2.5
- Registry auth standardized in ADR-PIPE-011
- Scaffolds delivered in PIPE-CORE-1.2.2

---

## 6. References

- PIPE-CORE-1.2 Epic
- PIPE-CORE-1.1 Evidence Contract
- ADR-PIPE-011 (OIDC Auth)
- ADR-PIPE-012 (Image Tagging Policy)

