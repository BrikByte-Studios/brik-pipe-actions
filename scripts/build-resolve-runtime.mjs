import { spawnSync } from "node:child_process";

const env = { ...process.env, TS_NODE_PROJECT: ".github/actions/resolve-runtime/tsconfig.json" };

const res = spawnSync(
  "npx",
  ["--yes", "@vercel/ncc", "build", ".github/actions/resolve-runtime/src/index.ts", "-o", ".github/actions/resolve-runtime/dist", "-t"],
  { stdio: "inherit", env }
);

process.exit(res.status ?? 1);
