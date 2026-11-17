// SPDX-License-Identifier: AGPL-3.0-or-later
// Bundles the CLI into build/postmodem.js next to SvelteKit's build/handler.js.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

const out = "build/postmodem.js";
await build({
  entryPoints: ["src/cli/postmodem.ts"],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  sourcemap: "linked",
  // The SvelteKit handler is loaded at runtime from the same directory.
  external: ["./handler.js"],
  // Some bundled dependencies are CommonJS and expect `require`.
  banner: {
    js: "import { createRequire as __pmCreateRequire } from 'node:module'; const require = __pmCreateRequire(import.meta.url);",
  },
  logLevel: "warning",
});
chmodSync(out, 0o755);
console.log(`built ${out}`);
