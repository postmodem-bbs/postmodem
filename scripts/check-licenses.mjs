#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fails if any dependency has a licence that can't be combined with AGPL-3.0 (ADR 0010).
// Dev dependencies are checked too: Svelte and SvelteKit are bundled into the shipped build.
import { execFileSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "MPL-2.0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "PostgreSQL",
  "AGPL-3.0-or-later",
  "AGPL-3.0-only",
  "GPL-3.0-or-later",
  "LGPL-3.0-or-later",
]);

const out = execFileSync("pnpm", ["licenses", "list", "--json", "--recursive"], { encoding: "utf8" });
const byLicence = JSON.parse(out);
const bad = [];
let count = 0;
for (const [licence, pkgs] of Object.entries(byLicence)) {
  // SPDX expressions like "(MIT OR Apache-2.0)": acceptable if any alternative is allowed.
  const options = licence.replace(/[()]/g, "").split(/\s+OR\s+/);
  const ok = options.some((o) => o.split(/\s+AND\s+/).every((p) => ALLOWED.has(p.trim())));
  for (const p of pkgs) {
    count++;
    if (!ok) bad.push(`${p.name}@${p.versions?.join(",") ?? "?"}: ${licence}`);
  }
}
if (bad.length) {
  console.error(`Dependency licence check failed:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`Dependency licence check passed: ${count} packages.`);
