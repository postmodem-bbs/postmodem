// SPDX-License-Identifier: AGPL-3.0-or-later
import { join } from "node:path";
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const dev = command === "serve";
  return {
    plugins: [
      sveltekit({
        // Keep generated files next to the app even when Vitest runs from the repo root.
        outDir: join(import.meta.dirname, ".svelte-kit"),
        adapter: adapter({ out: "build", precompress: true }),
        // Strict CSP; SvelteKit hashes its own inline bootstrap script.
        csp: {
          mode: "auto",
          directives: {
            "default-src": ["self"],
            "script-src": ["self"],
            // Vite injects styles at runtime in dev only.
            "style-src": dev ? ["self", "unsafe-inline"] : ["self"],
            "img-src": ["self", "data:"],
            "font-src": ["self"],
            "connect-src": dev ? ["self", "ws:"] : ["self"],
            "object-src": ["none"],
            "base-uri": ["self"],
            "form-action": ["self"],
            "frame-ancestors": ["none"],
          },
        },
      }),
    ],
    // Workspace packages ship TypeScript sources; bundle them into the server build.
    ssr: { noExternal: [/^@postmodem\//] },
    test: { include: ["src/**/*.test.ts"] },
  };
});
