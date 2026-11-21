// SPDX-License-Identifier: AGPL-3.0-or-later
// Imports the generated Przemo fixture (tools/fixtures) and checks the result against the
// fixture's manifest: every planted quirk must be found, nothing invented. Needs the fixture
// database: PM_TEST_MYSQL_URL=mysql://przemo:przemo@127.0.0.1:3306/przemo (CI runs one) and
// PM_TEST_FIXTURE_MANIFEST pointing at its manifest.json.
import { readFileSync } from "node:fs";
import {
  authenticate,
  coreRegistry,
  evaluate,
  GUEST,
  loadSnapshot,
  type Repositories,
  viewerFor,
} from "@postmodem/core";
import type { Database } from "@postmodem/db";
import { openTestDatabase, testEngines } from "@postmodem/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymise, type ImportReport, importLoginSecuritySettings, importPrzemo } from "./przemo.ts";
import { type LegacySource, openMysqlSource } from "./source.ts";

const URL = process.env.PM_TEST_MYSQL_URL;
const MANIFEST = process.env.PM_TEST_FIXTURE_MANIFEST;

describe.each(testEngines())("Przemo trash destinations (%s)", (engine) => {
  it("imports only valid forum destinations and rolls back a dry run", async () => {
    const db = await openTestDatabase(engine);
    try {
      await db.migrate();
      const forums = [
        { forum_id: 1, forum_name: "Source", cat_id: 1, forum_trash: 0 },
        { forum_id: 2, forum_name: "Destination", cat_id: 1, forum_trash: 1 },
        { forum_id: 3, forum_name: "Invalid destination", cat_id: 1, forum_trash: 100 },
      ];
      const empty = async () => [];
      const source: LegacySource = {
        prefix: "phpbb_",
        tables: async () => ["phpbb_categories", "phpbb_forums"],
        columns: async (table) => (table === "forums" ? Object.keys(forums[0]!) : []),
        all: async (table) =>
          table === "forums" ? forums : table === "categories" ? [{ cat_id: 1, cat_title: "Test" }] : [],
        batch: empty,
        query: empty,
        close: async () => {},
      };
      const r = db.repos;
      const field = () => r.fields.load("forum", [1, 2, 3], ["trash-bin.destination"]);
      expect((await importPrzemo(r, source, { dryRun: true })).counts["trash-bin"]?.imported).toBe(1);
      expect(await field()).toEqual(new Map());
      const result = await importPrzemo(r, source);
      expect(result.counts["trash-bin"]).toEqual({ read: 2, imported: 1, skipped: 1 });
      expect(result.notImported.columns.forums ?? []).not.toContain("forum_trash");
      expect(await field()).toEqual(
        new Map([
          [1, { "trash-bin.destination": 2 }],
          [3, { "trash-bin.destination": 2 }],
        ]),
      );
      expect((await importPrzemo(r, source)).resumed).toBe(true);
      expect(await field()).toEqual(
        new Map([
          [1, { "trash-bin.destination": 2 }],
          [3, { "trash-bin.destination": 2 }],
        ]),
      );
    } finally {
      await db.close();
    }
  });
});

interface Manifest {
  counts: Record<string, number>;
  accounts: { userId: number; username: string; password: string; level: string }[];
  forums: { id: number; access: "public" | "registered" | "private" | "moderators" }[];
  quirks: { kind: string; table: string; id: number }[];
}

describe.skipIf(!URL || !MANIFEST).each(testEngines())("Przemo fixture import (%s)", (engine) => {
  let db: Database;
  let r: Repositories;
  let report: ImportReport;
  const manifest = MANIFEST ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest) : undefined!;
  const planted = (kind: string) =>
    manifest.quirks
      .filter((q) => q.kind === kind)
      .map((q) => q.id)
      .sort((a, b) => a - b);

  beforeAll(async () => {
    db = await openTestDatabase(engine);
    await db.migrate();
    r = db.repos;
    const source = await openMysqlSource(URL!);
    try {
      report = await importPrzemo(r, source, { batchSize: 250 });
    } finally {
      await source.close();
    }
  }, 120_000);
  afterAll(() => db?.close());

  it("imports every user, topic and post, skipping only the orphan", async () => {
    // Przemo's install data adds the Admin account and a handful of topics and posts.
    expect(report.counts.users?.imported).toBe(manifest.counts.users! + 1);
    expect(report.counts.posts?.skipped).toBe(1);
    expect(report.counts.posts!.imported + report.counts.posts!.skipped).toBe(report.counts.posts!.read);
    expect(report.counts.topics?.skipped ?? 0).toBe(0);
  });

  it("finds exactly the planted quirks", () => {
    const found = (kind: string) => report.issues[kind as keyof typeof report.issues]?.count ?? 0;
    expect(found("dangling-poster")).toBe(planted("dangling-poster").length);
    expect(found("guest-poster")).toBe(planted("anonymous-poster").length);
    expect(found("orphan-post")).toBe(planted("orphan-post").length);
    expect(found("moved-shadow-topic")).toBe(planted("moved-shadow-topic").length);
    expect(found("stale-counters")).toBe(planted("stale-counters").length);
    expect(found("charset-repaired")).toBe(
      planted("cp1250-in-latin2").length + planted("utf8-in-latin2").length,
    );
  });

  it("repairs Windows-1250 and UTF-8 text and undoes phpBB2's escaping", async () => {
    const pangram = "Zażółć gęślą jaźń. Pchnąć w tę łódź jeża lub ośm skrzyń fig.";
    const ids = [...planted("cp1250-in-latin2"), ...planted("utf8-in-latin2")];
    const posts = await r.posts.getMany(ids);
    for (const id of ids) expect(posts.get(id)?.source.startsWith(pangram), `post ${id}`).toBe(true);
    for (const id of planted("html-entities")) {
      const p = await r.posts.get(id);
      expect(p?.source, `post ${id}`).toContain('Cena: 100 € "okazja" „cudzysłów” & <b>nie HTML</b>');
    }
    expect((await r.users.byUsername("Łukasz Żółć"))?.username).toBe("Łukasz Żółć");
  });

  it("keeps ids, so phpBB2 links still point at the same things", async () => {
    const [orphan] = planted("orphan-post");
    expect(await r.posts.get(orphan!)).toBeUndefined();
    const [shadow] = planted("moved-shadow-topic");
    expect((await r.topics.get(shadow!))?.movedToTopicId).toBeGreaterThan(0);
    for (const f of manifest.forums) expect((await r.nodes.get(f.id))?.kind, `forum ${f.id}`).toBe("forum");
  });

  it("imports polls with their options and lists the image files to copy", async () => {
    // Przemo's install data ships one poll, on topic 5.
    const poll = await r.polls.forTopic(5);
    expect(poll).toMatchObject({
      id: 1,
      question: "Czy podoba Ci się to Forum?",
      endsAt: null,
      hideResults: false,
    });
    expect(poll?.options.map((o) => o.text)).toEqual(["Tak", "Nie"]);
    expect(report.counts.polls).toEqual({ read: 1, imported: 1, skipped: 0 });
    expect(report.files).toContainEqual({
      from: "images/smiles/icon_smile.gif",
      to: "smilies/icon_smile.gif",
    });
    expect(report.notImported.byOrigin?.unknown).toEqual({ tables: [], columns: {} });
    // Przemo's feature switches survive anonymisation: values only "0"/"1".
    expect(Object.keys(report.featureSwitches).length).toBeGreaterThan(20);
    expect(Object.values(report.featureSwitches).every((v) => v === "0" || v === "1")).toBe(true);
    expect(anonymise(report).featureSwitches).toEqual(report.featureSwitches);
  });

  it("signs legacy users in with their old passwords and upgrades the hash", async () => {
    for (const a of manifest.accounts.slice(0, 3)) {
      const result = await authenticate(r, a.username, a.password);
      expect(result.ok, a.username).toBe(true);
      expect((await r.credentials.get(a.userId))?.scheme).toBe("argon2id");
    }
  });

  it("carries phpBB2's forum access over", async () => {
    const snapshot = await loadSnapshot(r);
    const registry = coreRegistry();
    const member = manifest.accounts.find((a) => a.level === "user")!;
    const admin = manifest.accounts.find((a) => a.level === "admin")!;
    const memberViewer = await viewerFor(r, member.userId);
    const adminViewer = await viewerFor(r, admin.userId);
    for (const f of manifest.forums) {
      const node = (await r.nodes.get(f.id))!;
      const can = (v: Parameters<typeof evaluate>[2], cap: string) =>
        evaluate(registry, snapshot, v, cap, node.id, node.path).allowed;
      const expected = {
        public: { guest: true, member: true },
        registered: { guest: false, member: true },
        private: { guest: false, member: false },
        moderators: { guest: false, member: false },
      }[f.access];
      expect(can(GUEST, "node.read"), `guest reads forum ${f.id} (${f.access})`).toBe(expected.guest);
      expect(can(memberViewer, "node.read"), `member reads forum ${f.id} (${f.access})`).toBe(
        expected.member,
      );
      expect(can(adminViewer, "node.read"), `admin reads forum ${f.id}`).toBe(true);
    }
  });

  it("is resumable: running again imports nothing twice", async () => {
    const source = await openMysqlSource(URL!);
    try {
      const again = await importPrzemo(r, source, { batchSize: 250 });
      expect(again.resumed).toBe(true);
      expect(again.counts.posts).toBeUndefined();
      expect(again.counts.users).toBeUndefined();
    } finally {
      await source.close();
    }
  });
});

it("maps supported legacy login settings and keeps the core password floor", () => {
  const config = new Map([
    ["max_login_error", "8"],
    ["block_time", "40"],
    ["min_password_len", "3"],
    ["force_complex_password", "1"],
    ["password_not_login", "0"],
  ]);
  expect(importLoginSecuritySettings(config)).toEqual({
    settings: { maxFailures: 8, blockMinutes: 40, minPasswordLength: 10, requireLettersAndNumbers: true },
    used: new Set(config.keys()),
  });
  expect(importLoginSecuritySettings(new Map([["block_time", "unknown"]]))).toEqual({
    settings: undefined,
    used: new Set(),
  });
});
