#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// ADR 0012: links to content (topics, forums, categories, users, posts) are built only by the
// urls service, so they follow the board's URL style. This fails on a hand-written content
// path in a string or template literal anywhere in the web app. Fixed pages that look the
// same in every style (`/`, `/register`, `/login.php`, `/reset`, …) are fine.
// The urls service itself, the reroute hook and tests are exempt.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN = "apps/server/src";
const EXTENSIONS = [".ts", ".js", ".svelte"];
const EXEMPT = [/^apps\/server\/src\/lib\/urls\.ts$/, /^apps\/server\/src\/hooks\.ts$/, /\.test\.ts$/];

// A quote or backtick, then a content path in any style: classic phpBB2 scripts with their
// content parameters, the numbered/slug prefixes, or the internal /-/ routes.
const CONTENT = [
  /viewtopic\.php/,
  /viewforum\.php/,
  /profile\.php\?mode=viewprofile/,
  /index\.php\?c=/,
  /\/(?:t|f|c|u|p|topic|forum|category|user|post)\/(?:\$\{|[\w~-])/,
  /\/-\/(?:topic|forum|category|user|post)\b/,
];
const LITERAL = /(["'`])((?:\\.|(?!\1).)*)\1/g;

const failures = [];
let checked = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (EXTENSIONS.some((e) => name.endsWith(e))) {
      const rel = relative(ROOT, full);
      if (EXEMPT.some((r) => r.test(rel))) continue;
      checked++;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|<!--)/.test(line)) return; // comments may describe URLs
          for (const [, , text] of line.matchAll(LITERAL)) {
            // Only paths: a literal starting with "/" (or "?" for query-only links).
            if (!/^[/?]/.test(text)) continue;
            if (CONTENT.some((r) => r.test(text)))
              failures.push(`${rel}:${i + 1}: "${text}" — build it with the urls service`);
          }
        });
    }
  }
};
walk(join(ROOT, SCAN));

if (failures.length) {
  console.error(
    `Link check failed (ADR 0012), ${failures.length} hand-written content path(s):\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`Link check passed: ${checked} files.`);
