/**
 * BrikByteOS Contract Regression Suite (v1)
 *
 * Aggregates all governance gates.
 */

import { spawnSync } from "node:child_process";

const gates = [
  "scripts/governance/check-workflow-inputs.mjs",
//   "scripts/governance/check-workflow-stage-order.mjs",
  "scripts/governance/check-workflow-outputs.mjs",
];

for (const g of gates) {
  const r = spawnSync("node", [g], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("🏁 BrikByteOS v1 Build Contract regression suite PASSED");
