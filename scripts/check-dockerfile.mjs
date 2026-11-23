#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies that the Dockerfile's deps stage copies every workspace package's manifest before
// `pnpm install`. A package left out gets no dependencies of its own in the image (#161).
import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
const block = /^packages:\n((?:\s+-\s+.+\n)+)/m.exec(workspace)?.[1] ?? "";
const patterns = [...block.matchAll(/-\s+["']?([^"'\s#]+)/g)].map((m) => m[1]);
if (!patterns.length) {
  console.error("check-dockerfile: no packages found in pnpm-workspace.yaml");
  process.exit(1);
}

const packages = patterns
  .flatMap((p) => globSync(p, { cwd: ROOT }))
  .filter((dir) => existsSync(join(ROOT, dir, "package.json")))
  .sort();

const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
const deps = /^FROM .* AS deps$([\s\S]*?)^FROM /m.exec(dockerfile)?.[1] ?? "";
const missing = packages.filter(
  (dir) => !new RegExp(`^COPY ${dir.replaceAll(".", "\\.")}/package\\.json `, "m").test(deps),
);

if (missing.length) {
  console.error("The Dockerfile's deps stage doesn't copy these workspace manifests:");
  for (const dir of missing) console.error(`  COPY ${dir}/package.json ${dir}/`);
  process.exit(1);
}
console.log(`Dockerfile check passed: ${packages.length} workspace packages.`);
