// SPDX-License-Identifier: AGPL-3.0-or-later
// Vite's `?raw` imports (the i18n catalogues, `*.ftl?raw`) for code run straight from source
// with plain Node, as the web build and the CLI bundle (apps/server/scripts/build-cli.mjs)
// already have them: the file's text as the default export. Loaded with
// `node --import ./scripts/raw-imports.mjs` by `pnpm cli` (#160).
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const RAW = "?raw";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith(RAW)) return nextResolve(specifier, context);
    const file = nextResolve(specifier.slice(0, -RAW.length), context);
    return { url: `${file.url}${RAW}`, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (!url.endsWith(RAW)) return nextLoad(url, context);
    const text = readFileSync(fileURLToPath(url.slice(0, -RAW.length)), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  },
});
