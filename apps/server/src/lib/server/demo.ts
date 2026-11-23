// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem seed-demo`: fills an EMPTY board with content that shows what's implemented —
// nested forums, announcements and stickies, long paginated topics, guest posts, posts
// exercising every BBCode feature, and the feature tour (#163): members with avatars,
// signatures and ranks, private messages, watches, a poll, a locked topic, an open report, a
// banned and a pending member. The words are in demo-content.ts. Refuses to touch a board
// that already has forums.
import { hashPassword, type Id, installCorePermissions, type Repositories } from "@postmodem/core";
import type { SupportedLocale } from "@postmodem/i18n";
import { reportsStore } from "@postmodem/modules";
import type { AvatarLimits } from "./avatars.ts";
import { storeAvatar } from "./avatars.ts";
import { demoAvatarPng } from "./demo-avatars.ts";
import {
  GUEST_ANSWER,
  MEMORIES,
  RULES,
  SHOWCASE,
  TOUR_CATEGORY,
  TOUR_FORUMS,
  TOUR_GALLERY,
  TOUR_MEMBERS,
  TOUR_MESSAGES,
  TOUR_RANK,
  TOUR_REPORTS,
  TOUR_TOPICS,
} from "./demo-content.ts";
import { INSTALLED_PACKAGES, packagePermissions } from "./packages.ts";
import { seedDefaultRanks } from "./ranks.ts";

/**
 * Demo members (not Admin) can sign in with this password, to try what registered users and
 * the Moderatorzy group see. A demo board is for looking around, never for real use.
 */
export const DEMO_PASSWORD = "postmodem-demo";

const DAY = 86_400_000;

export interface SeedResult {
  created: boolean;
  forums: number;
  topics: number;
  posts: number;
}

/** Where avatar images go. Without it (unit tests), the tour's members have no avatars. */
export interface DemoFiles {
  dataDir: string;
  limits: AvatarLimits;
}

export async function seedDemo(
  repos: Repositories,
  now = Date.now(),
  locale: SupportedLocale = "en",
  files?: DemoFiles,
): Promise<SeedResult> {
  if ((await repos.nodes.tree()).length) return { created: false, forums: 0, topics: 0, posts: 0 };

  const demoCredential = await hashPassword(DEMO_PASSWORD);
  return repos.transaction(async (r) => {
    let t = now - 30 * DAY;
    const tick = (ms = 47 * 60_000) => {
      t += ms;
      return t;
    };

    const smilies: [string, string, string][] = [
      [":-)", "smile.svg", "Uśmiech"],
      [";-)", "wink.svg", "Mrugnięcie"],
      [":-D", "grin.svg", "Szeroki uśmiech"],
      [":-(", "sad.svg", "Smutek"],
      [":lol:", "lol.svg", "Śmiech"],
      ["8-)", "cool.svg", "Fajnie"],
    ];
    for (const [i, [code, image, emotion]] of smilies.entries())
      await r.smilies.create({ code, image, emotion, position: i });

    const admin = await r.users.create({ username: "Admin", email: "admin@example.invalid", createdAt: t });
    const lukasz = await r.users.create({
      username: "Łukasz Żółć",
      email: null,
      location: "Łódź",
      createdAt: tick(),
    });
    const fan = await r.users.create({
      username: "retro_fan",
      email: null,
      location: "Kraków",
      createdAt: tick(),
    });
    const ola = await r.users.create({ username: "Ola", email: null, createdAt: tick() });
    const people = [admin, lukasz, fan, ola];
    for (const person of [lukasz, fan, ola])
      await r.credentials.set(person.id, demoCredential.scheme, demoCredential.hash);
    const moderators = await r.groups.create({
      name: "Moderatorzy",
      description: "Pilnują porządku.",
      kind: "closed",
      createdAt: t,
    });
    await r.groups.addMember({ groupId: moderators.id, userId: ola.id, role: "member", pending: false });
    // The default ranks (#130): Admin owns the board, Ola moderates it, the rest are users.
    const ranks = await seedDefaultRanks(r, locale);
    for (const [user, rank] of [
      [admin, "owner"],
      [ola, "mod"],
    ] as const) {
      const given = ranks?.get(rank);
      if (given) await r.users.update(user.id, { rankId: given.id });
    }

    const general = await r.nodes.create({ parentId: null, kind: "category", title: "Ogólne", position: 1 });
    const hardware = await r.nodes.create({
      parentId: null,
      kind: "category",
      title: "Sprzęt i oprogramowanie",
      position: 2,
    });
    const news = await r.nodes.create({
      parentId: general.id,
      kind: "forum",
      title: "Ogłoszenia",
      description: "Nowości o forum i o Postmodem.",
      position: 1,
    });
    const park = await r.nodes.create({
      parentId: general.id,
      kind: "forum",
      title: "Hydepark",
      description: "Rozmowy o wszystkim i o niczym.",
      position: 2,
    });
    const retro = await r.nodes.create({
      parentId: park.id,
      kind: "forum",
      title: "Gry retro",
      description: "Przemo sub-forum: forum wewnątrz forum.",
      position: 1,
    });
    const computers = await r.nodes.create({
      parentId: hardware.id,
      kind: "forum",
      title: "Komputery",
      description: "Hardware talk, in any language.",
      position: 1,
    });
    const software = await r.nodes.create({
      parentId: hardware.id,
      kind: "forum",
      title: "Oprogramowanie",
      description: "",
      position: 2,
    });

    // Permission showcase (ADR 0015).
    const members = await r.nodes.create({
      parentId: general.id,
      kind: "forum",
      title: "Strefa użytkowników",
      description: "Tylko dla zarejestrowanych: goście jej nie widzą.",
      position: 3,
    });
    const modroom = await r.nodes.create({
      parentId: park.id,
      kind: "forum",
      title: "Moderatornia",
      description: "Ukryte pod-forum dla grupy Moderatorzy.",
      position: 2,
    });
    const archive = await r.nodes.create({
      parentId: hardware.id,
      kind: "forum",
      title: "Archiwum",
      description: "Widoczne dla wszystkich, czytać mogą zarejestrowani; nikt już tu nie pisze.",
      position: 3,
    });

    let topicCount = 0;
    let postCount = 0;
    const authored = new Map<Id, number>();
    const topic = async (
      nodeId: Id,
      title: string,
      type: string,
      posts: [Id | null, string][],
      guestName = "Gość",
    ) => {
      const first = posts[0]!;
      const created = await r.topics.create({
        nodeId,
        title,
        type,
        authorId: first[0],
        authorName: first[0] === null ? guestName : "",
        createdAt: tick(),
      });
      for (const [authorId, source] of posts) {
        await r.posts.create({
          topicId: created.id,
          authorId,
          authorName: authorId === null ? guestName : "",
          source,
          format: "bbcode-phpbb2",
          createdAt: tick(31 * 60_000),
        });
        postCount++;
        if (authorId !== null) authored.set(authorId, (authored.get(authorId) ?? 0) + 1);
      }
      topicCount++;
      await r.topics.addViews(created.id, posts.length * 13 + 7);
      return r.topics.recount(created.id);
    };

    await topic(news.id, "Witamy na forum Postmodem!", "announcement", [[admin.id, SHOWCASE]]);
    await topic(park.id, "Regulamin forum", "sticky", [[admin.id, RULES]]);
    await topic(
      park.id,
      "Wasze pierwsze komputery",
      "normal",
      Array.from({ length: 42 }, (_, i): [Id | null, string] => [
        i === 9 ? null : people[i % people.length]!.id,
        MEMORIES[i % MEMORIES.length]!,
      ]),
    );
    await topic(
      park.id,
      "Pytanie od gościa",
      "normal",
      [
        [null, "Czy trzeba się rejestrować, żeby czytać? :-("],
        [ola.id, GUEST_ANSWER],
      ],
      "Anonim",
    );
    for (let i = 1; i <= 30; i++) {
      await topic(park.id, `Wątek numer ${i}: ${i % 2 ? "o grach" : "o muzyce"}`, "normal", [
        [people[i % people.length]!.id, `Treść wątku ${i}. Strony listy tematów mają po 25 wątków.`],
      ]);
    }
    const amiga = await topic(retro.id, "Najlepsza gra na Amigę?", "normal", [
      [fan.id, "Moim zdaniem [b]Sensible Soccer[/b]."],
      [lukasz.id, '[quote="retro_fan"]Sensible Soccer[/quote]Nie, [i]Settlers[/i]! :-D'],
    ]);
    await r.polls.create({
      topicId: amiga.id,
      question: "Na czym graliście najwięcej?",
      startsAt: t,
      endsAt: null,
      hideResults: false,
      options: [
        { position: 1, text: "Amiga 500", votes: 7 },
        { position: 2, text: "Atari ST", votes: 2 },
        { position: 3, text: "Commodore 64", votes: 3 },
      ],
    });
    await topic(computers.id, "Which PSU for an old Pentium build?", "normal", [
      [ola.id, "Looking for an AT power supply. Any tips?"],
      [admin.id, "Check www.example.org for [u]refurbished[/u] units."],
    ]);
    await topic(software.id, "Ulubiony edytor tekstu", "normal", [[lukasz.id, "[code]:wq[/code]"]]);
    await topic(members.id, "Tajny zlot użytkowników", "normal", [[lukasz.id, "Spotykamy się w sobotę!"]]);
    await topic(modroom.id, "Zgłoszenia do przejrzenia", "normal", [[ola.id, "Nic nowego, cisza i spokój."]]);
    await topic(archive.id, "Stare ogłoszenia z 2004 roku", "normal", [
      [admin.id, "Forum przeniesione na nowy serwer."],
    ]);

    const roles = await installCorePermissions(r, packagePermissions(INSTALLED_PACKAGES)).then(async () => ({
      hidden: (await r.roles.byKey("core:hidden"))!.id,
      noRead: (await r.roles.byKey("core:no-read"))!.id,
      reader: (await r.roles.byKey("core:reader"))!.id,
      readOnly: (await r.roles.byKey("core:read-only"))!.id,
      participant: (await r.roles.byKey("core:participant"))!.id,
      moderator: (await r.roles.byKey("core:moderator"))!.id,
      admin: (await r.roles.byKey("core:admin"))!.id,
    }));
    await r.grants.create(roles.hidden, { type: "everyone" }, members.id);
    await r.grants.create(roles.participant, { type: "registered" }, members.id);
    await r.grants.create(roles.hidden, { type: "everyone" }, modroom.id);
    await r.grants.create(roles.moderator, { type: "group", id: moderators.id }, modroom.id);
    // The moderators look after "Gry retro" too: a public forum with a moderator (reports e2e).
    await r.grants.create(roles.moderator, { type: "group", id: moderators.id }, retro.id);
    await r.grants.create(roles.noRead, { type: "everyone" }, archive.id);
    await r.grants.create(roles.readOnly, { type: "registered" }, archive.id);
    await r.grants.create(roles.admin, { type: "user", id: admin.id }, null);

    // ── the feature tour (#163), after the base board so its IDs stay the same ──
    const tour = await seedTour(r, {
      tick,
      topic,
      credential: demoCredential,
      original: { admin, ola, lukasz, fan },
      ranks,
      files,
    });

    for (const node of [news, park, retro, computers, software, members, modroom, archive, ...tour.forums])
      await r.nodes.recount(node.id);
    for (const person of [...people, ...tour.members])
      await r.users.update(person.id, { postCount: authored.get(person.id) ?? 0 });
    await r.audit.append({
      actorId: null,
      action: "demo.seeded",
      targetType: "board",
      targetId: "demo",
      details: { topics: topicCount, posts: postCount },
    });
    return { created: true, forums: 8 + tour.forums.length, topics: topicCount, posts: postCount };
  });
}

interface TourContext {
  tick: (ms?: number) => number;
  topic: (
    nodeId: Id,
    title: string,
    type: string,
    posts: [Id | null, string][],
  ) => Promise<Awaited<ReturnType<Repositories["topics"]["recount"]>>>;
  credential: Awaited<ReturnType<typeof hashPassword>>;
  original: Record<"admin" | "ola" | "lukasz" | "fan", { id: Id }>;
  ranks: Awaited<ReturnType<typeof seedDefaultRanks>>;
  files?: DemoFiles;
}

/** The feature tour: everything in demo-content.ts's second part. */
async function seedTour(r: Repositories, c: TourContext) {
  const who = new Map<string, { id: Id }>(Object.entries(c.original));

  // The gallery the avatar picker shows, and the members' own avatars.
  const gallery: string[] = [];
  if (c.files)
    for (const name of TOUR_GALLERY.images) {
      const png = demoAvatarPng(`gallery-${name}`);
      const stored = await storeAvatar(
        c.files.dataDir,
        png,
        c.files.limits,
        `gallery/${TOUR_GALLERY.category}`,
        `${name}.png`,
      );
      if ("avatar" in stored) gallery.push(stored.avatar);
    }

  const rank = await r.ranks.create({
    title: TOUR_RANK,
    titleKey: null,
    minPosts: null,
    special: true,
    image: null,
  });
  const members = [];
  for (const m of TOUR_MEMBERS) {
    let avatar: string | null = null;
    if (c.files && m.avatar === "upload") {
      const stored = await storeAvatar(c.files.dataDir, demoAvatarPng(m.username), c.files.limits);
      if ("avatar" in stored) avatar = stored.avatar;
    } else if (m.avatar === "gallery") avatar = gallery[0] ?? null;
    const user = await r.users.create({
      username: m.username,
      email: m.email ?? null,
      status: m.status,
      createdAt: c.tick(),
      rankId: m.specialRank ? rank.id : null,
      signatureSource: m.signature ?? "",
      avatar,
      location: m.location ?? "",
      website: m.website ?? "",
      locale: m.locale ?? null,
      timezone: m.timezone ?? null,
    });
    if (m.status === "active") await r.credentials.set(user.id, c.credential.scheme, c.credential.hash);
    if (m.banned)
      await r.bans.create({
        kind: "user",
        value: String(user.id),
        reason: m.banned,
        createdBy: c.original.admin.id,
        expiresAt: null,
      });
    who.set(m.key, user);
    members.push(user);
  }
  const id = (key: string) => {
    const found = who.get(key);
    if (!found) throw new Error(`demo-content: no member '${key}'`);
    return found.id;
  };

  const category = await r.nodes.create({
    parentId: null,
    kind: "category",
    title: TOUR_CATEGORY,
    position: 3,
  });
  const forums = new Map<string, { id: Id }>();
  for (const [i, f] of TOUR_FORUMS.entries())
    forums.set(
      f.key,
      await r.nodes.create({
        parentId: category.id,
        kind: "forum",
        title: f.title,
        description: f.description,
        position: i + 1,
      }),
    );

  const topics = new Map<string, Id>();
  for (const t of TOUR_TOPICS) {
    const forum = forums.get(t.forum);
    if (!forum) throw new Error(`demo-content: no forum '${t.forum}'`);
    const created = await c.topic(
      forum.id,
      t.title,
      t.type ?? "normal",
      t.posts.map(([author, source]) => [id(author), source]),
    );
    if (!created) continue;
    topics.set(t.title, created.id);
    if (t.locked) await r.topics.setLocked(created.id, true);
    if (t.poll)
      await r.polls.create({
        topicId: created.id,
        question: t.poll.question,
        startsAt: c.tick(0),
        endsAt: null,
        hideResults: false,
        options: t.poll.options.map(([text, votes], i) => ({ position: i + 1, text, votes })),
      });
    for (const watcher of t.watchedBy ?? []) await r.watches.watch(id(watcher), created.id);
  }

  for (const m of TOUR_MESSAGES) {
    const at = c.tick(9 * 60_000);
    await r.messages.create({
      senderId: id(m.from),
      recipientId: id(m.to),
      subject: m.subject,
      source: m.source,
      createdAt: at,
      readAt: m.read ? at + 60_000 : null,
    });
  }

  const reports = reportsStore(r.raw);
  for (const report of TOUR_REPORTS) {
    const topicId = topics.get(report.topic);
    const post = topicId ? (await r.posts.allInTopic(topicId))[report.post] : undefined;
    if (post)
      await reports.create({
        postId: post.id,
        reporterId: id(report.by),
        reason: report.reason,
        now: c.tick(),
      });
  }

  return { forums: [...forums.values()], members };
}

/**
 * Adds one topic with `posts` posts, in a forum of its own, to any board (demo or imported):
 * the deep pages a performance test needs (DESIGN §5.1), which the fixtures don't have.
 */
export async function seedLongTopic(repos: Repositories, posts: number, now = Date.now()) {
  return repos.transaction(async (r) => {
    const forum = await r.nodes.create({
      parentId: null,
      kind: "forum",
      title: "Testy wydajności",
      description: `Jeden temat z ${posts} postami (postmodem seed-demo --long-topic).`,
    });
    const authors = (await r.users.getMany([1, 2, 3, 4, 5])).values().toArray();
    const topic = await r.topics.create({
      nodeId: forum.id,
      title: `Bardzo długi temat (${posts} postów)`,
      authorId: authors[0]?.id ?? null,
      createdAt: now - posts * 60_000,
    });
    for (let j = 0; j < posts; j++) {
      const author = authors.length ? authors[j % authors.length]! : null;
      await r.posts.create({
        topicId: topic.id,
        authorId: author?.id ?? null,
        authorName: author ? "" : "Gość",
        source: `Post numer [b]${j + 1}[/b]. ${MEMORIES[j % MEMORIES.length]}`,
        format: "bbcode-phpbb2",
        createdAt: now - (posts - j) * 60_000,
      });
    }
    await r.topics.recount(topic.id);
    await r.nodes.recount(forum.id);
    return { forumId: forum.id, topicId: topic.id, posts };
  });
}
