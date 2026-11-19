#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The repository's rulesets live in .github/rulesets/*.json (branch and tag protection as
// code, CONTRIBUTING.md "Branch rules"). Uses the GitHub CLI.
//
//   node scripts/rulesets.mjs check   # does GitHub enforce what the files say? (CI, read-only)
//   node scripts/rulesets.mjs apply   # create or update them (a repository admin, locally)
//
// Exit codes: 0 in sync / applied · 1 missing or different · 3 GitHub won't enforce rulesets
// for this repository (a private repository on a free plan).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/rulesets";
const mode = process.argv[2];
if (mode !== "check" && mode !== "apply") {
  console.error("usage: node scripts/rulesets.mjs check|apply");
  process.exit(2);
}

const repo =
  process.env.GITHUB_REPOSITORY ??
  gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
const wanted = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

class PlanError extends Error {}

function api(method, path, body) {
  try {
    const out = gh(
      [
        "api",
        "-X",
        method,
        "-H",
        "Accept: application/vnd.github+json",
        path,
        ...(body ? ["--input", "-"] : []),
      ],
      body ? JSON.stringify(body) : undefined,
    );
    return out ? JSON.parse(out) : null;
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    if (/Upgrade to GitHub Pro or make this repository public/i.test(text)) throw new PlanError(text);
    throw new Error(`gh api ${method} ${path} failed:\n${text}`);
  }
}

/** Every key the file sets must match what GitHub has; GitHub may add its own defaults. */
function differences(want, have, path = "") {
  if (Array.isArray(want)) {
    if (!Array.isArray(have) || have.length !== want.length)
      return [`${path}: ${JSON.stringify(have)} ≠ ${JSON.stringify(want)}`];
    return want.flatMap((w, i) => differences(w, have[i], `${path}[${i}]`));
  }
  if (want && typeof want === "object") {
    if (!have || typeof have !== "object") return [`${path}: missing`];
    return Object.keys(want).flatMap((k) => differences(want[k], have[k], path ? `${path}.${k}` : k));
  }
  return want === have ? [] : [`${path}: ${JSON.stringify(have)} ≠ ${JSON.stringify(want)}`];
}

const sortRules = (r) => {
  const rules = [...(r.rules ?? [])].sort((a, b) => a.type.localeCompare(b.type));
  for (const rule of rules)
    rule.parameters?.required_status_checks?.sort((a, b) => a.context.localeCompare(b.context));
  return { ...r, rules };
};

try {
  const existing = api("GET", `repos/${repo}/rulesets?includes_parents=false`);
  let drift = 0;
  for (const want of wanted) {
    const found = existing.find((r) => r.name === want.name && r.target === want.target);
    if (mode === "apply") {
      if (found) api("PUT", `repos/${repo}/rulesets/${found.id}`, want);
      else api("POST", `repos/${repo}/rulesets`, want);
      console.log(`${found ? "updated" : "created"} ruleset '${want.name}'`);
      continue;
    }
    if (!found) {
      console.log(`::error::ruleset '${want.name}' is not on GitHub (run: node scripts/rulesets.mjs apply)`);
      drift = 1;
      continue;
    }
    const have = api("GET", `repos/${repo}/rulesets/${found.id}`);
    // Bypass lists are only shown to admins; compare them when GitHub shows them.
    const { bypass_actors, ...rest } = sortRules(want);
    const diffs = differences(have.bypass_actors ? { ...rest, bypass_actors } : rest, sortRules(have));
    if (diffs.length) {
      console.log(`::error::ruleset '${want.name}' differs from ${DIR}:\n  ${diffs.join("\n  ")}`);
      drift = 1;
    } else console.log(`ruleset '${want.name}' is in force as written`);
  }
  process.exit(drift);
} catch (e) {
  if (e instanceof PlanError) {
    console.log(
      `::warning::GitHub does not enforce rulesets for ${repo} on its current plan (private repository, free plan). ` +
        "main is protected only by convention and the main-guard workflow; see CONTRIBUTING.md, Branch rules.",
    );
    process.exit(3);
  }
  console.error(e.message);
  process.exit(1);
}
