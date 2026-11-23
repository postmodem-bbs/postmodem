# Live demo on your own machine

Everything runs in one Docker container on `http://localhost:8080`, with demo content and
no e-mail set up. Takes about two minutes. Nothing here is meant to be reachable from the
internet: for testers on another machine, see [CONTAINERS.md §4.6](CONTAINERS.md#46-a-public-staging-board-m2a).

Two ways to run it; pick one and follow only its commands in steps 1 and 2.

- **A. Docker** (needs only Docker): the published image `ghcr.io/postmodem-bbs/postmodem:0.1.0`.
- **B. From the source checkout** (needs Node 24 and pnpm): no Docker, works before the
  image is published.

## 1. Start the board

**A. Docker**

```bash
docker run -d --name postmodem-demo -p 8080:8080 -v postmodem-demo:/data ghcr.io/postmodem-bbs/postmodem:0.1.0
```

**B. From the source checkout**, in the repository folder (one terminal, keep it open: the
board's log, including the e-mails it would send, shows here):

```bash
pnpm install && pnpm build
```

```bash
POSTMODEM_DATA_DIR=var/live-demo node apps/server/build/postmodem.js run
```

Give it ten seconds, then open <http://localhost:8080>: an empty board.

## 2. Fill it with the demo content

In a second terminal, a shortcut for the board's command line.

**A. Docker:**

```bash
alias pm='docker exec -i postmodem-demo /nodejs/bin/node /app/postmodem.js'
```

**B. From the source checkout** (in the repository folder):

```bash
alias pm='POSTMODEM_DATA_DIR=var/live-demo node apps/server/build/postmodem.js'
```

From here on, the commands are the same for both.

```bash
pm demo
```

That fills the board with the demo content, gives every demo account the password
`postmodem-demo` (Admin included) and makes it demo-friendly: registering without e-mail,
posting as fast as you like. The running board picks the settings up within five seconds.
Forgot a password, or changed a setting? Run `pm demo` again: it puts them back.

(With Docker, `-e POSTMODEM_DEMO=1` on the `docker run` in step 1 does all of this when the
board starts, and you can skip this step.)

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
first terminal for B, or for A:

```bash
docker logs -f postmodem-demo
```

## 5. Afterwards

**B. From the source checkout:** Ctrl+C in the first terminal stops it; the content stays in
`var/live-demo` for next time. For a fresh demo, delete it:

```bash
rm -rf var/live-demo
```

**A. Docker:** stop it (the content stays for next time):

```bash
docker stop postmodem-demo
```

Start it again later:

```bash
docker start postmodem-demo
```

Throw everything away, for a fresh demo:

```bash
docker rm -f postmodem-demo && docker volume rm postmodem-demo
```
