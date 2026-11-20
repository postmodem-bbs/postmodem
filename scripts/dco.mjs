#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// The one DCO check (ADR 0010, CONTRIBUTING.md), shared by the git hooks and CI:
// every non-merge commit carries "Signed-off-by: Name <email>" whose e-mail is the commit
// author's. People and coding agents are held to the same rule.
//
//   node scripts/dco.mjs <rev-list arguments…>   check commits, e.g. origin/main..HEAD
//   node scripts/dco.mjs --message <file>        check a commit message (commit-msg hook)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A trailer line, not text quoted in the body or a "#" comment git strips later. */
const signedOffBy = (message, email) =>
  new RegExp(`^Signed-off-by: .+ <${escapeRegExp(email)}>\\s*$`, "im").test(
    message
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n"),
  );

const HOW = `
Sign off with: git commit -s (or --amend -s for the last commit).
Commits already made: git rebase --signoff <base>, e.g. git rebase --signoff origin/main
Signing off certifies the Developer Certificate of Origin (https://developercertificate.org/)
for the person whose git identity makes the commit. Coding agents sign off as that person
and never as anyone else; see AGENTS.md.`;

function checkMessage(file) {
  // Merges are exempt, as in CI: they never reach main (squash merges only).
  if (existsSync(join(git("rev-parse", "--git-dir"), "MERGE_HEAD"))) return 0;
  const ident = git("var", "GIT_AUTHOR_IDENT");
  const email = /<([^>]*)>/.exec(ident)?.[1] ?? "";
  if (signedOffBy(readFileSync(file, "utf8"), email)) return 0;
  console.error(`dco: this commit has no "Signed-off-by: … <${email}>" line, so it was not made.${HOW}`);
  return 1;
}

function checkCommits(revs) {
  const shas = git("rev-list", "--no-merges", ...revs)
    .split("\n")
    .filter(Boolean);
  const missing = [];
  for (const sha of shas) {
    const [email, ...body] = git("log", "-1", "--format=%ae%n%B", sha).split("\n");
    if (!signedOffBy(body.join("\n"), email))
      missing.push(`  ${git("log", "-1", "--format=%h %s", sha)} (author ${email})`);
  }
  if (!missing.length) {
    console.log(`dco: ${shas.length} commit(s) signed off.`);
    return 0;
  }
  console.error(
    `dco: ${missing.length} commit(s) without a matching Signed-off-by:\n${missing.join("\n")}${HOW}`,
  );
  return 1;
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/dco.mjs <rev-list arguments…> | --message <file>");
  process.exit(2);
}
process.exit(args[0] === "--message" ? checkMessage(args[1]) : checkCommits(args));
