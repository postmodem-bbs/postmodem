#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage (from the repo root):
//   pnpm fixtures:generate [--preset small] [--seed 42]
//   pnpm fixtures:image    [--preset small] [--seed 42] [--tag <image>] [--smoke]
// Output goes to var/fixtures/ (never committed).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { GENERATOR_VERSION, generate, type Manifest } from "./generate.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const OUT = join(ROOT, "var/fixtures");
const IMAGE_REPO = "ghcr.io/postmodem-bbs/fixture-przemo";

function args(argv: string[]) {
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[a.slice(2)] = next;
      i++;
    } else opts[a.slice(2)] = true;
  }
  return opts;
}

async function generateToDisk(preset: string, seed: number): Promise<{ dump: string; manifest: Manifest }> {
  mkdirSync(OUT, { recursive: true });
  const base = join(OUT, `przemo-${preset}-s${seed}-g${GENERATOR_VERSION}`);
  const gz = createGzip({ level: 6 });
  const file = createWriteStream(`${base}.sql.gz`);
  gz.pipe(file);
  const started = Date.now();
  const manifest = generate(preset, seed, (b) => gz.write(b));
  gz.end();
  await new Promise<void>((r, j) => file.on("finish", r).on("error", j));
  writeFileSync(`${base}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `generated ${base}.sql.gz in ${Date.now() - started} ms: ${manifest.counts.posts} posts, ${manifest.counts.users} users, ${manifest.quirks.length} quirks (sha256 ${manifest.sha256.slice(0, 12)})`,
  );
  return { dump: `${base}.sql.gz`, manifest };
}

function sh(cmd: string, a: string[], opts: { input?: string } = {}) {
  return execFileSync(cmd, a, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"], ...opts }).trim();
}

async function buildImage(preset: string, seed: number, tag: string, smoke: boolean) {
  const { dump, manifest } = await generateToDisk(preset, seed);
  const ctx = join(OUT, `context-${preset}`);
  mkdirSync(join(ctx, "schema"), { recursive: true });
  for (const f of ["mysql_schema.sql", "mysql_basic.sql"])
    copyFileSync(join(ROOT, "tools/fixtures/przemo/schema", f), join(ctx, "schema", f));
  copyFileSync(dump, join(ctx, "data.sql.gz"));
  writeFileSync(join(ctx, "manifest.json"), JSON.stringify(manifest, null, 2));
  const dockerfile = join(ROOT, "tools/fixtures/docker/Dockerfile");
  console.log(`building ${tag} …`);
  const build = spawnSync(
    "docker",
    [
      "build",
      "-f",
      dockerfile,
      "-t",
      tag,
      "--label",
      `org.postmodem.fixture.sha256=${manifest.sha256}`,
      "--build-arg",
      `PRESET=${preset}`,
      ctx,
    ],
    { stdio: "inherit" },
  );
  if (build.status !== 0) throw new Error("docker build failed");
  if (smoke) smokeTest(tag, manifest);
}

/** Start the image, check the database answers and contains what the manifest says. */
function smokeTest(tag: string, manifest: Manifest) {
  const name = `pm-fixture-smoke-${process.pid}`;
  sh("docker", ["run", "-d", "--name", name, tag]);
  try {
    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i++) {
      healthy = sh("docker", ["inspect", "-f", "{{.State.Health.Status}}", name]) === "healthy";
      if (!healthy) spawnSync("sleep", ["1"]);
    }
    if (!healthy) throw new Error("fixture container never became healthy");
    const q = (sql: string) =>
      sh("docker", ["exec", name, "mariadb", "-uprzemo", "-pprzemo", "-N", "-B", "przemo", "-e", sql]);
    const posts = Number(q("SELECT COUNT(*) FROM phpbb_posts"));
    const users = Number(q("SELECT COUNT(*) FROM phpbb_users"));
    const pangramHex = q(
      `SELECT HEX(LEFT(post_text, 10)) FROM phpbb_posts_text WHERE post_id = ${manifest.quirks.find((x) => x.kind === "cp1250-in-latin2")?.id ?? 0}`,
    );
    // 5 posts and 2 users come from Przemo's own install data.
    if (posts !== manifest.counts.posts! + 5)
      throw new Error(`posts: ${posts}, expected ${manifest.counts.posts! + 5}`);
    if (users !== manifest.counts.users! + 2)
      throw new Error(`users: ${users}, expected ${manifest.counts.users! + 2}`);
    console.log(
      `smoke test passed: ${posts} posts, ${users} users; cp1250 sample bytes ${pangramHex || "(none in this preset)"}`,
    );
  } finally {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const o = args(rest);
const preset = String(o.preset ?? "small");
const seed = Number(o.seed ?? 42);
const version = JSON.parse(readFileSync(join(ROOT, "tools/fixtures/package.json"), "utf8")).version as string;

if (cmd === "generate") await generateToDisk(preset, seed);
else if (cmd === "image")
  await buildImage(preset, seed, String(o.tag ?? `${IMAGE_REPO}:${version}-${preset}`), o.smoke === true);
else {
  console.error(
    "usage: cli.ts generate|image [--preset tiny|small|large] [--seed N] [--tag IMAGE] [--smoke]",
  );
  process.exit(2);
}
if (existsSync(OUT)) process.exitCode ??= 0;
