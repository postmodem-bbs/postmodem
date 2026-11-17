#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies that every source file carries the SPDX licence header expected for its path (ADR 0010).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = ["apps", "packages", "scripts", "e2e"];
const EXTENSIONS = [".ts", ".js", ".mjs", ".cjs", ".svelte", ".css", ".ftl"];
const SKIP = new Set(["node_modules", "build", "dist", ".svelte-kit", "out", "test-results"]);

const expected = (path) => (path.startsWith("packages/sdk/") ? "Apache-2.0" : "AGPL-3.0-or-later");

const failures = [];
let checked = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      const rel = relative(ROOT, full);
      const head = readFileSync(full, "utf8").split("\n", 6).join("\n");
      const m = /SPDX-License-Identifier:\s*([^\s*>-]+(?:-[^\s*>]+)*)/.exec(head);
      checked++;
      if (!m) failures.push(`${rel}: missing SPDX-License-Identifier`);
      else if (m[1] !== expected(rel)) failures.push(`${rel}: has ${m[1]}, expected ${expected(rel)}`);
    }
  }
};
for (const d of SCAN) {
  try {
    walk(join(ROOT, d));
  } catch {
    /* directory may not exist yet */
  }
}

if (failures.length) {
  console.error(`SPDX check failed (${failures.length} of ${checked} files):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`SPDX check passed: ${checked} files.`);
