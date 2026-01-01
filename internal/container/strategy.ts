/**
 * Container Build Strategy (v1)
 *
 * This module encodes the *enforceable* decision rules defined in ADR-PIPE-010.
 * It is intentionally small and pure (no side effects) so it can be reused by:
 * - workflow wrapper scripts (node)
 * - policy gates (tagging rules)
 * - future CLI tooling (brik-pipe)
 *
 * Note: Auth and caching deep logic lives in PIPE-CORE-1.2.4.
 */

export type Builder = "buildx" | "kaniko";
export type Mode = "dry_run" | "build_only" | "build_and_push";

export type RunnerConstraint = {
  /** True if Docker daemon usage is allowed/available in the environment. */
  dockerDaemonAllowed: boolean;
  /** True if privileged containers are allowed. */
  privilegedAllowed: boolean;
  /** True if org policy forbids docker.sock mount. */
  dockerSockForbidden: boolean;
};

export type StrategyDecision = {
  builder: Builder;
  reason: string;
  constraintsApplied: string[];
};

export function decideBuilder(constraints: RunnerConstraint, preferred: Builder = "buildx"): StrategyDecision {
  const applied: string[] = [];

  // MUST use Kaniko if daemon or privilege is not allowed.
  if (!constraints.dockerDaemonAllowed) {
    applied.push("dockerDaemonAllowed=false");
    return { builder: "kaniko", reason: "Docker daemon not allowed/available; Kaniko required.", constraintsApplied: applied };
  }

  if (!constraints.privilegedAllowed) {
    applied.push("privilegedAllowed=false");
    return { builder: "kaniko", reason: "Privileged mode not allowed; Kaniko required.", constraintsApplied: applied };
  }

  if (constraints.dockerSockForbidden) {
    applied.push("dockerSockForbidden=true");
    return { builder: "kaniko", reason: "docker.sock mount forbidden by policy; Kaniko required.", constraintsApplied: applied };
  }

  // Otherwise, prefer Buildx.
  applied.push("buildxPreferred");
  return { builder: preferred, reason: "Buildx permitted; preferred for speed/caching.", constraintsApplied: applied };
}

/**
 * v1 mode rules:
 * - dry_run: validate inputs/tagging/dockerfile, no push required
 * - build_only: build without push
 * - build_and_push: push required + SHA tag required (policy gate enforces details)
 */
export function modeRequiresPush(mode: Mode): boolean {
  return mode === "build_and_push";
}
