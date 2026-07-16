import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const hosted = process.env.HOSTED_MODE === "1";

function runNode(script) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNode("scripts/migrate.mjs");
if (hosted) runNode("scripts/seed.mjs");

const nextArguments = [
  path.join(root, "node_modules", "next", "dist", "bin", "next"),
  "start",
  "--hostname",
  hosted ? "0.0.0.0" : "127.0.0.1",
];
if (process.env.PORT?.trim()) {
  nextArguments.push("--port", process.env.PORT.trim());
}

const server = spawnSync(process.execPath, nextArguments, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
process.exit(server.status ?? 1);
