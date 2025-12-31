/**
 * Build script for validate-build-config action.
 * Bundles TS entrypoint with ncc into dist/index.js (hermetic CI action).
 */
import { execSync } from "node:child_process";
import path from "node:path";

const actionDir = path.join(process.cwd(), ".github", "actions", "validate-build-config");

// Run ncc *inside the action directory* so it uses ./tsconfig.json there.
execSync("ncc build src/index.ts -o dist", {
  cwd: actionDir,
  stdio: "inherit",
});


