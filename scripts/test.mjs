#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

// Globs in `--test` need Node 22, and shell expansion of `**` needs globstar.
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found.sort();
}

const files = collect("test");
if (files.length === 0) {
  process.stderr.write("No test files found under test/\n");
  process.exit(1);
}

const extra = process.argv.includes("--coverage") ? ["--experimental-test-coverage"] : [];
const result = spawnSync("tsx", ["--test", ...extra, ...files], {
  stdio: "inherit",
  env: { ...process.env, LOG_LEVEL: process.env.LOG_LEVEL ?? "silent" },
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
