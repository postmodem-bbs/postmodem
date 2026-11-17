# ADR 0016 — Accounts and sessions: Argon2id, opaque server-side sessions, delays not lockouts

- Status: accepted · 2026-11-17 (M1 slice 4)

## Context
Postmodem must accept the passwords of imported phpBB2/Przemo users, resist credential
stuffing without letting attackers lock real users out, and keep sign-in working without
JavaScript. The Przemo code in `old_przemo_phpBB/` checks phpass `$H$` hashes first and
falls back to plain MD5, rehashing on success. phpBB2 hashed the request value *after* PHP's
magic quotes, so passwords containing `'`, `"` or `\` were stored with backslashes.

## Decision
- **Hashing:** Argon2id via Node's built-in `crypto.argon2` (no native module), OWASP
  baseline m=19 MiB, t=2, p=1, stored as PHC strings. Weaker parameters are rehashed on the
  next successful sign-in. Legacy `phpbb2-md5` and `phpass` (`$H$`/`$P$`) hashes are verified
  as typed and with magic-quotes escaping, then replaced with Argon2id; the upgrade is
  audited. Unknown accounts are checked against a decoy hash so timing doesn't reveal names.
- **Password policy:** length only (10–1024), no composition rules, not equal to the
  username or e-mail (NIST 800-63B). A breached-password check stays optional and off.
- **Usernames:** 2–25 characters (phpBB2's limit) of letters, digits and single separators
  between them; one script per name; phpBB2-style disallow list with `*`. Uniqueness uses a
  lookalike **skeleton** (Cyrillic/Greek homoglyphs, `0/o`, `1/l/i`, `rn/m`, `ł/l`,
  separators dropped), stored in `users.username_skeleton`.
- **Sessions:** a random 256-bit token in a cookie; the database stores only its SHA-256.
  `__Host-pm_session` (`Secure`) when the board is served over HTTPS, `pm_session` otherwise;
  `HttpOnly`, `SameSite=Lax`. Idle expiry 30 days (sliding, written at most every 5 minutes),
  absolute 90 days. Rotated on sign-in; "sign out on all devices"; sessions of users who
  aren't active stop working at once. Pages for signed-in users are `Cache-Control: private`.
- **CSRF:** every state change is a POST form; SvelteKit's origin check rejects cross-site
  posts. Sign-out is POST only (phpBB2's `login.php?logout=true` GET is not honoured).
- **Throttling:** progressive delays per account (5 free failures, then 1 s doubling to
  5 min) and per IP (50 free), registrations per IP (10 per hour). No lockouts. In memory
  per process for now.
- **First admin:** `postmodem init` from `POSTMODEM_ADMIN_*`, idempotent, exempt from the
  reserved-name list.

## Consequences
- Stack mode with several web replicas throttles per replica until the DB-backed store lands
  with the job queue (slice 4b), together with mail, e-mail verification and password reset.
  Until then registrations are active immediately.
- The importer (slice 6) stores `user_password` with `legacyScheme()`; no user has to reset.
- A lookalike rule can refuse a legitimate name ("Oia" vs "Ola"); admins can still create it.
