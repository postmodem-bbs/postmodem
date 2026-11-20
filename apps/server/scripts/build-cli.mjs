// SPDX-License-Identifier: AGPL-3.0-or-later
// Bundles the CLI into build/postmodem.js next to SvelteKit's build/handler.js.
import { chmodSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

/** Vite's `?raw` imports (the i18n catalogues, `*.ftl?raw`) as text, as the web build has them. */
const rawImports = {
  name: "raw-imports",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

const out = "build/postmodem.js";
await build({
  plugins: [rawImports],
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
