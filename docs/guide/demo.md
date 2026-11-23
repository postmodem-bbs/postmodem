# Demo board

A board full of demo content, where every account signs in with one click: for trying
Postmodem, showing it to someone, or checking a change. It runs on your own machine at
<http://localhost:8080>. Nothing here is meant to be reachable from the internet: the demo
accounts, Admin included, share a published password (`postmodem doctor` fails on a demo
board at a public address).

## 1. Start it

Pick one.

**A. Docker, one command** (needs only Docker):

```bash
docker run -d --name postmodem-demo -p 8080:8080 -e POSTMODEM_DEMO=1 -v postmodem-demo:/data ghcr.io/postmodem-bbs/postmodem:edge
```

`POSTMODEM_DEMO=1` sets an empty board up as the demo when it starts. (`:edge` is the latest
build of `main`; releases before the demo command don't have it.)

**B. The installer** (needs Docker; see [install.md](install.md)), from a checkout:

```bash
sh deploy/install.sh --solo --demo
```

or without one, into `./postmodem`:

```bash
curl -fsSL https://raw.githubusercontent.com/postmodem-bbs/postmodem/main/deploy/install.sh | sh -s -- --solo --demo --version edge
```

**C. From the source checkout** (needs Node 24 and pnpm; see [develop.md](develop.md)). One
terminal, kept open: the board's log, including the e-mails it would send, shows here.

```bash
pnpm install && pnpm build
```

```bash
POSTMODEM_DATA_DIR=var/live-demo POSTMODEM_DEMO=1 node apps/server/build/postmodem.js run
```

Give it ten seconds, then open <http://localhost:8080>.

## 2. The board's command line

A shortcut, in a second terminal:

**A. Docker:**

```bash
alias pm='docker exec -i postmodem-demo postmodem'
```

**B. The installer** (in the folder it set up):

```bash
alias pm='docker compose -f compose.solo.yaml exec -T postmodem postmodem'
```

**C. From the source checkout** (in the repository folder):

```bash
alias pm='POSTMODEM_DATA_DIR=var/live-demo pnpm -s cli'
```

Forgot a password, or changed a setting while trying things? This puts the demo's passwords
and settings back:

```bash
pm demo
```

## 3. Who you can be

The sign-in page lists every account with a **Sign in as …** button. They all use the
password `postmodem-demo`.

| Sign in as | Shows |
|---|---|
| `Admin` | the admin panel (**Admin** in the header) |
| `Ola` | a moderator of "Gry retro" and the hidden "Moderatornia" |
| `Łukasz Żółć` | a regular member |
| `retro_fan` | another member, for private messages and reports |
| `Kasia` | a member with everything filled in: avatar, signature, special rank, messages |

Use a normal window and a private window to be two people at once.

## 4. A tour that shows it off (about 15 minutes)

1. **It's phpBB2.** Open <http://localhost:8080/viewtopic.php?t=3>: an old-style link works
   as is. Page through the topic; note "Page 1 of 3".
2. **Links are a setting.** In the terminal: `pm settings set core.urls.style slug`. Reload
   the same old link: it redirects to `/topic/wasze-pierwsze-komputery`. Switch back with
   `pm settings set core.urls.style classic`.
3. **Looks and language.** At the bottom of any page, switch to Polish and to the dark theme.
   Narrow the window to phone width: everything still fits.
4. **Posting.** Sign in as `Łukasz Żółć`, open "Hydepark" → **New topic**. Use the toolbar,
   **Preview**, then **Post**. Reply with the quick-reply box under the posts; **Quote** a
   post; **Edit** your own.
5. **Unread.** In the private window, sign in as `retro_fan`: Łukasz's new topic shows a
   "new" badge, in the forum list and on the index. Open it; the badge goes.
6. **Private messages.** As `retro_fan`, click **Messages** → **New message** to
   `Łukasz Żółć`. In the other window the header shows a count; open, reply (it quotes).
7. **Reports and moderation.** As `retro_fan`, open "Gry retro" → "Najlepsza gra na Amigę?"
   and **Report** Łukasz's reply. Sign in as `Ola`: **Reports 1** in the header. Close the
   report (retro_fan gets a message saying so). On the topic, **Moderate**: lock it, split a
   post into a new topic, merge it back.
8. **Search.** Search for `zeby czytac`, typed without Polish letters: it finds "Czy trzeba
   się rejestrować, żeby czytać?". Search `sobote` as a guest (nothing: it's in a
   members-only forum), then signed in (found: "Spotykamy się w sobotę!").
9. **Admin.** Sign in as `Admin` → **Admin**: board settings, forums, groups, members,
   bans and invites. In **Permissions**, check "May `guest` read *Moderatornia*?" and see
   which grants decide it.
10. **Joining.** Sign out and **Register** a new account: the anti-bot check runs invisibly
    (no puzzles to solve) and you're in.
11. **The feature tour.** The **Pokaz funkcji · Feature tour** category on the index has a place
    for each feature: avatars (uploaded and from the gallery), signatures and a special rank in
    "Przedstaw się", a poll and members in other time zones in "English corner", a locked
    topic, a banned member's post and an open report in "Moderacja na pokaz". Sign in as
    `Admin` for an unread message and the report, or as `Kasia` for her conversation with Tom.

E-mails the board would send (notifications, password resets) go to its log instead: the
first terminal for C, or `docker logs -f postmodem-demo` for A, or `docker compose -f
compose.solo.yaml logs -f` for B.

## 5. A fresh demo

The demo content grows with every visible feature (CONTRIBUTING.md, "Demo board"). To see
what's new after an update, throw the old demo away and start again.

**A. Docker:**

```bash
docker rm -f postmodem-demo && docker volume rm postmodem-demo
```

then pull the image again (`docker pull ghcr.io/postmodem-bbs/postmodem:edge`) and run step 1.

**B. The installer** (in its folder):

```bash
docker compose -f compose.solo.yaml down -v && docker compose -f compose.solo.yaml pull && docker compose -f compose.solo.yaml up -d --wait
```

**C. From the source checkout:** stop the board (Ctrl+C), `git pull && pnpm build`, then

```bash
pm demo --reset
```

and start it again as in step 1.
