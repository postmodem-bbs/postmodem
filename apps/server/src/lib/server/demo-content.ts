// SPDX-License-Identifier: AGPL-3.0-or-later
// What the demo board says and who is on it (#163), apart from how it is seeded (demo.ts).
//
// Two parts:
// - the base board (forums, topics and the four original accounts): the e2e suite's fixture.
//   Its order and IDs must not change: specs open t=3, f=6 and count Hydepark's pages.
// - the feature tour, appended after it: one place per visible feature. A pull request that
//   adds something visible adds it here (CONTRIBUTING.md, "Demo board").

// ── base board ────────────────────────────────────────────────────────────────────────────

export const SHOWCASE = `Witajcie na forum [b]Postmodem[/b]! :-D

To jest pokaz formatowania postów:

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

Cześć, [you]! Ten fragment widzi każdy, ale [hide]ten jest ukryty[/hide] — do czasu odpowiedzi w tym temacie.

[scroll]Przewijany tekst, jak w 2005 roku ;-)[/scroll]

Więcej do obejrzenia w kategorii [b]Pokaz funkcji · Feature tour[/b].`;

export const RULES = `[b]Regulamin / Rules[/b]

[list=1]
[*]Bądźcie dla siebie mili. / Be kind to each other.
[*]Bez spamu i reklam. / No spam, no ads.
[*]Pisz po polsku albo po angielsku. / Polish or English, both are fine.
[/list]

Naruszenia zgłaszajcie moderatorom 8-)`;

export const MEMORIES = [
  "Mój pierwszy był [b]Commodore 64[/b]. Kasety ładowały się wieki :lol:",
  "Atari 65XE i joystick Quickshot. Do dziś pamiętam [i]River Raid[/i].",
  "ZX Spectrum od wujka. Gumowa klawiatura!",
  "Pentium 75 MHz, 8 MB RAM, Windows 95. I modem 33.6k — ten dźwięk :-D",
  "Amiga 500 z rozszerzeniem pamięci. [color=green]Najlepsze gry na świecie[/color].",
  "Mine was a 486DX2 with a Sound Blaster. Doom ran beautifully.",
  '[quote="retro_fan"]Gumowa klawiatura![/quote]O tak, i ten kolorowy ekran ładowania :-)',
  "Pierwszy dostęp do internetu w kafejce — i pierwsze forum na phpBB2 ;-)",
];

export const GUEST_ANSWER = "Nie, czytanie jest otwarte. Zarejestruj się, gdy zechcesz coś napisać ;-)";

// ── feature tour ──────────────────────────────────────────────────────────────────────────

/** Members of the tour. `key` names them in the topics, messages and reports below. */
export interface DemoMember {
  key: string;
  username: string;
  /** Active members sign in with the demo password; pending ones wait for their e-mail. */
  status: "active" | "pending";
  email?: string;
  location?: string;
  website?: string;
  locale?: "en" | "pl";
  timezone?: string;
  signature?: string;
  /** upload: their own (drawn at seed time); gallery: picked from the board's gallery. */
  avatar?: "upload" | "gallery";
  /** Given the tour's special rank. */
  specialRank?: boolean;
  /** Banned, with this reason. */
  banned?: string;
}

export const TOUR_MEMBERS: DemoMember[] = [
  {
    key: "kasia",
    username: "Kasia",
    status: "active",
    location: "Gdańsk",
    website: "https://example.org",
    locale: "pl",
    timezone: "Europe/Warsaw",
    signature: "[i]Kasia z Gdańska[/i] · [url=https://example.org]mój blog o grach[/url] :-)",
    avatar: "upload",
    specialRank: true,
  },
  {
    key: "tom",
    username: "Tom",
    status: "active",
    location: "Leeds",
    locale: "en",
    timezone: "Europe/London",
    signature: "[b]Tom[/b] — retro hardware, one capacitor at a time.",
    avatar: "upload",
  },
  {
    key: "mika",
    username: "Mika",
    status: "active",
    location: "Ōsaka",
    locale: "en",
    timezone: "Asia/Tokyo",
    avatar: "gallery",
  },
  {
    key: "spammer",
    username: "tanie_zegarki_24",
    status: "active",
    banned: "Spam (pokaz banów)",
  },
  {
    key: "newcomer",
    username: "nowy_czlonek",
    status: "pending",
    email: "nowy_czlonek@example.invalid",
  },
];

/** The special rank, given by hand (#130). */
export const TOUR_RANK = "Weteranka forum";

/** The avatar gallery's demo category (#131): images members pick instead of uploading. */
export const TOUR_GALLERY = { category: "Demo", images: ["Fala", "Las", "Morze", "Pustynia"] };

export const TOUR_CATEGORY = "Pokaz funkcji · Feature tour";

export interface DemoForum {
  key: string;
  title: string;
  description: string;
}

export const TOUR_FORUMS: DemoForum[] = [
  {
    key: "intro",
    title: "Przedstaw się · Introductions",
    description: "Profiles at a glance: avatars, signatures, ranks, locations.",
  },
  {
    key: "english",
    title: "English corner",
    description: "The board in English: a poll, quotes and a watched topic.",
  },
  {
    key: "moderation",
    title: "Moderacja na pokaz · Moderation",
    description: "A locked topic, an open report and a banned member's post. Sign in as Admin.",
  },
];

/** A post: who wrote it (a member key, or an original account: admin, ola, lukasz, fan). */
export type DemoPost = [author: string, source: string];

export interface DemoTopic {
  forum: string;
  title: string;
  type?: "normal" | "sticky";
  locked?: boolean;
  posts: DemoPost[];
  poll?: { question: string; options: [text: string, votes: number][] };
  /** Members watching it (notifications on reply). */
  watchedBy?: string[];
}

export const TOUR_TOPICS: DemoTopic[] = [
  {
    forum: "intro",
    title: "Cześć, jestem Kasia!",
    posts: [
      [
        "kasia",
        "Hej wszystkim! Gram od czasów Amigi, teraz zbieram stare konsole. Mój podpis i awatar widać pod każdym postem.",
      ],
      ["tom", "Welcome, Kasia! Lovely avatar. I'm Tom, I fix old computers in Leeds."],
      [
        "mika",
        "Hello from Ōsaka! My avatar comes from the board's gallery: [i]Profile → Avatar → Gallery[/i].",
      ],
      ["admin", "Witamy! Kasia ma specjalną rangę „Weteranka forum”: nadaje ją administrator."],
    ],
    watchedBy: ["kasia"],
  },
  {
    forum: "english",
    title: "Which theme do you browse in?",
    posts: [
      [
        "tom",
        "The board comes with a classic theme and a modern one, each in light and dark. Pick yours at the bottom of any page.",
      ],
      [
        "mika",
        '[quote="Tom"]Pick yours at the bottom of any page.[/quote]Dark modern here, it\'s late in Japan :-)',
      ],
      ["kasia", "Classic, always. It looks like 2005 and I love it ;-)"],
    ],
    poll: {
      question: "Your favourite theme?",
      options: [
        ["Classic", 5],
        ["Classic (dark)", 2],
        ["Modern", 3],
        ["Modern (dark)", 4],
      ],
    },
    watchedBy: ["tom"],
  },
  {
    forum: "english",
    title: "Time zones: when did I post this?",
    posts: [
      [
        "mika",
        "Every member picks their own time zone and date format in their preferences, so post times show in your own clock.",
      ],
      ["tom", "Mine says Europe/London. Yours shows Tokyo time on your screen and London time on mine."],
    ],
  },
  {
    forum: "moderation",
    title: "Ten temat jest zamknięty · This topic is locked",
    type: "sticky",
    locked: true,
    posts: [
      [
        "ola",
        "Zamknięty i przyklejony: nikt poza moderatorami już tu nie odpowie. / Locked and sticky: only moderators can reply.",
      ],
    ],
  },
  {
    forum: "moderation",
    title: "Super okazja!!!",
    posts: [
      ["spammer", "Tanie zegarki, tylko dziś!!! www.example.invalid"],
      ["kasia", "Zgłosiłam ten post moderatorom. / I've reported this post."],
    ],
  },
];

/** Private messages. Unread ones show as a count in the recipient's header. */
export interface DemoMessage {
  from: string;
  to: string;
  subject: string;
  source: string;
  read: boolean;
}

export const TOUR_MESSAGES: DemoMessage[] = [
  {
    from: "kasia",
    to: "admin",
    subject: "Spam w moderacji",
    source: "Zgłosiłam post w „Super okazja!!!”. Zajrzysz do zgłoszeń? :-)",
    read: false,
  },
  {
    from: "tom",
    to: "kasia",
    subject: "Amiga 500 parts",
    source: "Hi Kasia, do you still have that spare Amiga 500 keyboard?",
    read: true,
  },
  {
    from: "kasia",
    to: "tom",
    subject: "Re: Amiga 500 parts",
    source:
      '[quote="Tom"]do you still have that spare Amiga 500 keyboard?[/quote]Yes! Send me a message when you need it.',
    read: false,
  },
];

/** Open reports (the reports package): a post, by its topic's title and position. */
export const TOUR_REPORTS = [
  { topic: "Super okazja!!!", post: 0, by: "kasia", reason: "Spam: reklama zegarków." },
];
