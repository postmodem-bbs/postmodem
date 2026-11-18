// SPDX-License-Identifier: AGPL-3.0-or-later
// Architecture rules from ADR 0002: Svelte and infrastructure stay at the edges.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-is-framework-free",
      comment:
        "packages/core must not depend on Svelte, HTTP frameworks, DB drivers or other workspace packages.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: {
        path: "(svelte|@sveltejs|kysely|drizzle-orm|postgres|@electric-sql|node:sqlite|^packages/(db|ui|i18n)|@postmodem/(db|ui|i18n|server)|^apps/)",
      },
    },
    {
      name: "sdk-is-framework-free",
      comment: "The Apache-2.0 SDK must not depend on Svelte or on AGPL implementation packages.",
      severity: "error",
      from: { path: "^packages/sdk/" },
      to: {
        path: "(svelte|@sveltejs|^packages/(core|db|ui|i18n)|@postmodem/(core|db|ui|i18n|server)|^apps/)",
      },
    },
    {
      name: "modules-use-the-package-api",
      comment:
        "First-party packages use core's package API and their own tables (Kysely), never the database layer's internals or the app (PACKAGES.md, M2 slice 3).",
      severity: "error",
      from: { path: "^packages/modules/", pathNot: "\\.test\\.ts$" },
      to: {
        path: "(svelte|@sveltejs|^packages/(db|ui|importer)/|@postmodem/(db|ui|importer|server)|^apps/)",
      },
    },
    {
      name: "importer-talks-to-ports-only",
      comment:
        "The importer writes through core's repository interfaces, never the database layer or the app.",
      severity: "error",
      from: { path: "^packages/importer/", pathNot: "\\.test\\.ts$" },
      to: { path: "(svelte|@sveltejs|kysely|^packages/(db|ui|i18n)|@postmodem/(db|ui|i18n|server)|^apps/)" },
    },
    {
      name: "svelte-only-at-the-edge",
      comment: "Only apps/* and packages/ui may import Svelte.",
      severity: "error",
      from: { path: "^packages/(core|db|i18n|sdk)/" },
      to: { path: "(^|/)node_modules/(svelte|@sveltejs)/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(\\.svelte-kit|build|dist|node_modules/\\.pnpm)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    combinedDependencies: true,
  },
};
