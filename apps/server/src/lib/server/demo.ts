// SPDX-License-Identifier: AGPL-3.0-or-later
// `postmodem seed-demo`: fills an EMPTY board with content that shows what's implemented —
// nested forums, announcements and stickies, long paginated topics, guest posts, and posts
// exercising every BBCode feature. Refuses to touch a board that already has forums.
import type { Id, Repositories } from "@postmodem/core";

const DAY = 86_400_000;

const SHOWCASE = `Witajcie na forum [b]Postmodem[/b]! :-D

To jest pokaz tego, co już działa (stan po M1 slice 2):

[list]
[*][b]pogrubienie[/b], [i]kursywa[/i], [u]podkreślenie[/u]
[*][color=red]kolory[/color] z palety phpBB2, [color=#336699]także zapisane szesnastkowo[/color]
[*]rozmiary: [size=9]mały[/size], [size=18]duży[/size], [size=24]ogromny[/size]
[*]efekty Przemo: [glow=blue]poświata[/glow], [shadow=red]cień[/shadow], [fade]pulsowanie[/fade]
[/list]

[quote="Przemo"]Wszystkie dodatkowe funkcje można wyłączyć w Panelu Administracyjnym.[/quote]

[code]// kod pokazany dosłownie, [b]bez[/b] formatowania:
for (const post of topic.posts) render(post);[/code]

[center]Linki: [url=https://github.com/postmodem-bbs/postmodem]repozytorium[/url], albo po prostu www.example.org :-)[/center]

Cześć, [you]! Ten fragment widzi każdy, ale [hide]ten jest ukryty[/hide] — do czasu modułu „ukryj do odpowiedzi”.

[scroll]Przewijany tekst, jak w 2005 roku ;-)[/scroll]`;

const RULES = `[b]Regulamin / Rules[/b]

[list=1]
[*]Bądźcie dla siebie mili. / Be kind to each other.
[*]Bez spamu i reklam. / No spam, no ads.
[*]Pisz po polsku albo po angielsku. / Polish or English, both are fine.
[/list]

Naruszenia zgłaszajcie moderatorom 8-)`;

const MEMORIES = [
  "Mój pierwszy był [b]Commodore 64[/b]. Kasety ładowały się wieki :lol:",
  "Atari 65XE i joystick Quickshot. Do dziś pamiętam [i]River Raid[/i].",
  "ZX Spectrum od wujka. Gumowa klawiatura!",
  "Pentium 75 MHz, 8 MB RAM, Windows 95. I modem 33.6k — ten dźwięk :-D",
  "Amiga 500 z rozszerzeniem pamięci. [color=green]Najlepsze gry na świecie[/color].",
  "Mine was a 486DX2 with a Sound Blaster. Doom ran beautifully.",
  '[quote="retro_fan"]Gumowa klawiatura![/quote]O tak, i ten kolorowy ekran ładowania :-)',
  "Pierwszy dostęp do internetu w kafejce — i pierwsze forum na phpBB2 ;-)",
];

export interface SeedResult {
  created: boolean;
  forums: number;
  topics: number;
  posts: number;
}

export async function seedDemo(repos: Repositories, now = Date.now()): Promise<SeedResult> {
  if ((await repos.nodes.tree()).length) return { created: false, forums: 0, topics: 0, posts: 0 };

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
        [ola.id, "Nie, czytanie jest otwarte. Rejestracja przyjdzie w slice 4 ;-)"],
      ],
      "Anonim",
    );
    for (let i = 1; i <= 30; i++) {
      await topic(park.id, `Wątek numer ${i}: ${i % 2 ? "o grach" : "o muzyce"}`, "normal", [
        [people[i % people.length]!.id, `Treść wątku ${i}. Strony listy tematów mają po 25 wątków.`],
      ]);
    }
    await topic(retro.id, "Najlepsza gra na Amigę?", "normal", [
      [fan.id, "Moim zdaniem [b]Sensible Soccer[/b]."],
      [lukasz.id, '[quote="retro_fan"]Sensible Soccer[/quote]Nie, [i]Settlers[/i]! :-D'],
    ]);
    await topic(computers.id, "Which PSU for an old Pentium build?", "normal", [
      [ola.id, "Looking for an AT power supply. Any tips?"],
      [admin.id, "Check www.example.org for [u]refurbished[/u] units."],
    ]);
    await topic(software.id, "Ulubiony edytor tekstu", "normal", [[lukasz.id, "[code]:wq[/code]"]]);

    for (const node of [news, park, retro, computers, software]) await r.nodes.recount(node.id);
    for (const person of people) await r.users.update(person.id, { postCount: authored.get(person.id) ?? 0 });
    await r.audit.append({
      actorId: null,
      action: "demo.seeded",
      targetType: "board",
      targetId: "demo",
      details: { topics: topicCount, posts: postCount },
    });
    return { created: true, forums: 5, topics: topicCount, posts: postCount };
  });
}
