# ADR 0017 — Job queue v0 in the database, and mail only through it

- Status: accepted · 2026-11-17 (M1 slice 4b)

## Context
DESIGN §4 promises background work without Redis, and CONTAINERS §2 splits `web`, `worker`
and `scheduler` roles out of one image. The first real job is mail: verification and reset
links must not wait on an SMTP server inside a web request, must survive restarts and
outages, and must work the same on SQLite (solo) and Postgres (stack, several workers).

## Decision
- **One `jobs` table** (type, JSON payload as text, status, run_at, attempts, lease). Same
  schema and code on both engines.
- **Claiming is optimistic and portable:** read a few due candidates, then take one with a
  conditional `UPDATE … WHERE id = ? AND <still due>`; whoever updates the row owns it.
  No `FOR UPDATE SKIP LOCKED` (Postgres-only), no engine-specific branches. Good enough for
  tens of jobs per second, which is what a forum produces.
- **Leases, not locks:** a claimed job carries `locked_until` (2 min). A crashed worker's job
  becomes due again when the lease runs out, so delivery is **at least once**; handlers must
  tolerate repeats (a duplicate e-mail is acceptable, a lost one is not).
- **Retries:** exponential backoff (30 s, 2 min, 8 min, …, max 6 h), 5 attempts, then
  `failed` with the last error kept.
- **Payloads are wiped when a job finishes**, done or failed for good: a mail job carries a
  one-time link, and the jobs table shouldn't become a second copy of live tokens.
- **Workers poll** every second when idle; a job enqueued in the same process (solo mode,
  dev server) wakes the local worker at once. `run`, `worker` and the dev server run a
  worker; `web` replicas don't. SIGTERM finishes the job in hand.
- **Mail never leaves a web request directly.** `POSTMODEM_MAIL_URL` selects `log://`
  (default: messages go to the log), `smtp://` (STARTTLS when offered) or `smtps://`, via
  nodemailer. Messages are plain text, rendered in the recipient's language when queued.
  `postmodem doctor` checks that the SMTP server answers.
- **The scheduler** purges finished jobs after 7 days, expired sessions and stale
  throttle rows hourly.

## Consequences
- Stack mode needs a `worker` container for mail to go out; compose.yaml has one.
- With `log://` (the default), new accounts can only be confirmed by someone who reads the
  logs; the start-up log warns, and `core.registration.verifyEmail` can be turned off.
- A busier queue (federation, thumbnails) can move to `SKIP LOCKED` on Postgres or to
  Valkey behind the same repository interface without changing callers.
