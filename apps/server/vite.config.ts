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
            // Vite injects styles at runtime in dev only. In production the only inline style is
            // SvelteKit's route announcer (screen-reader live region), allowed by its exact hash.
            // e2e fails on any CSP violation, so a SvelteKit change to that string is caught.
            "style-src": dev
              ? ["self", "unsafe-inline"]
              : ["self", "unsafe-hashes", "sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo="],
            // [img] in posts points at external hosts (loaded with no-referrer). An image proxy
            // for reader privacy is a later option.
            "img-src": ["self", "data:", "https:"],
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
