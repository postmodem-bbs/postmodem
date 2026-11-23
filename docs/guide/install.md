# Installing a board

Postmodem ships as one container image, `ghcr.io/postmodem-bbs/postmodem`, signed with cosign.
It runs in one of two shapes:

- **Solo**: one container, SQLite and uploaded files in a Docker volume. For a small board, a
  Raspberry Pi or a small VPS. Put a TLS-terminating proxy in front of it for anything public.
- **Stack**: Docker Compose with Postgres, Caddy (automatic HTTPS) and several web replicas.

Postmodem is an early preview (0.x): data formats may still change before 1.0. Migrations
carry a board forward, but there is no downgrade, so back up before upgrading
([administer.md](administer.md#backups)).

## The installer

The quickest way to a running board is [`deploy/install.sh`](../../deploy/install.sh). It asks
what it needs, writes the configuration, generates the stack's secrets, starts the board and
creates the first administrator. It needs Docker with Compose v2.

Without a checkout, it downloads the compose files for the latest release into `./postmodem`:

```bash
curl -fsSL https://raw.githubusercontent.com/postmodem-bbs/postmodem/main/deploy/install.sh | sh
```

From a checkout, it uses the files in `deploy/` and the `:edge` image:

```bash
sh deploy/install.sh
```

| Option | What it does |
|---|---|
| `--solo`, `--stack` | the shape (default: solo) |
| `--demo` | a [demo board](demo.md) instead of an empty one |
| `--dir <path>` | where the board's files go (default `./postmodem`, or `deploy/` from a checkout) |
| `--version <v>` | a release such as `0.2.0`, or `edge` for the latest build of `main` |
| `--image <ref>` | a specific image, e.g. one you built (`postmodem:local`) |
| `--url <url>` | the public address (solo default `http://localhost:<port>`) |
| `--port <n>` | solo: the port on this machine (default 8080) |
| `--domain <name>` | stack: the domain Caddy requests a certificate for |
| `--mail-url <url>` | `smtp://user:pass@host:587` to send e-mail; the default `log://` only logs it |
| `--admin-name`, `--admin-email` | the first administrator; the password is asked for, or read from `POSTMODEM_ADMIN_PASSWORD` |
| `--yes` | don't ask: flags and defaults only |

Running it again is safe: it never overwrites `.env`, the secrets, the compose files or the
board's data. To change something, edit `.env` in the board's folder and run
`docker compose up -d` there (solo: `docker compose -f compose.solo.yaml up -d`).

## Solo by hand

```bash
docker run -d --name postmodem -p 8080:8080 -v postmodem-data:/data --read-only --tmpfs /tmp ghcr.io/postmodem-bbs/postmodem:0.1
```

`:0.1` follows the latest 0.1.x release; `:edge` is the latest tested build of `main`. Then
create the first administrator. The password goes in on stdin:

```bash
printf '%s' 'a long passphrase' | docker exec -i -e POSTMODEM_ADMIN_EMAIL=you@example.org -e POSTMODEM_ADMIN_PASSWORD_FILE=/dev/stdin postmodem postmodem init
```

The same with Compose: [`deploy/compose.solo.yaml`](../../deploy/compose.solo.yaml).

## Stack by hand

In a copy of [`deploy/`](../../deploy/):

```bash
cp .env.example .env
```

Set `POSTMODEM_PUBLIC_URL` and `POSTMODEM_DOMAIN` in `.env`, and real SMTP
(`POSTMODEM_MAIL_URL`): without mail nobody can confirm an account. Then the secrets:

```bash
mkdir -p secrets && openssl rand -base64 32 > secrets/db_password && openssl rand -base64 48 > secrets/secret_key
```

```bash
docker compose up -d
```

`migrate` runs first; the web, worker and scheduler services start once it succeeds. Create
the administrator as for solo, with `docker compose exec -T web` in place of `docker exec -i
postmodem`. Optional services join with profiles: `--profile search` (Meilisearch),
`--profile scale` (Valkey for counters and live updates). See [configure.md](configure.md).

Behind a reverse proxy you already run (nginx, Traefik, Nginx Proxy Manager), see
[below](#behind-a-reverse-proxy).

## Behind a reverse proxy

Set `POSTMODEM_PUBLIC_URL` to the public HTTPS URL. At the public edge, replace any
client-supplied `X-Forwarded-For` with the connecting client's IP. Each subsequent
proxy must append its connecting peer's IP. Count every proxy that forwards
requests to Postmodem, including the shipped Caddy if you keep it.

Set `POSTMODEM_PROXY_HOPS` to that count (maximum 32) and set
`POSTMODEM_TRUSTED_PROXIES` to the proxy addresses or CIDRs as they appear
to Postmodem, including the immediate TCP peer. Use the narrowest ranges that
cover your proxies and restrict access to the backend port to those peers.
Postmodem checks the proxy hops from right to left. If the expected part of
the chain is missing, malformed, or includes an untrusted proxy, it uses the
immediate peer's IP. With zero hops it always uses the peer's IP.

**Stack with Caddy behind the TLS terminator.** Use the shipped Compose override
(Compose 2.24.4 or newer). For a TLS terminator → Caddy → Postmodem chain,
set `POSTMODEM_PROXY_HOPS=2`. Include both proxies in
`POSTMODEM_TRUSTED_PROXIES` and list the upstream proxy addresses as Caddy
sees them in `POSTMODEM_CADDY_TRUSTED_PROXIES`, separated by spaces. For
container deployments these can be Docker gateway or container addresses,
depending on how the upstream connects. Keep the full proxy chain in the
header that reaches Postmodem.

```bash
docker compose -f compose.yaml -f compose.reverse-proxy.yaml up -d
```

Caddy listens on plain HTTP. Point a same-host TLS terminator at
`http://127.0.0.1:8080`. To connect from another host or container, set
`POSTMODEM_PROXY_BIND` to a reachable private host address and restrict the
published port to the upstream proxy. `POSTMODEM_HTTP_PORT` changes the host port.
The normal stack command without the override continues to serve HTTPS at Caddy.

**Solo.** Point your TLS terminator at the solo service, restrict its published
port to your proxy (for a same-host proxy, bind it to loopback in the Compose
file), and set the same two Postmodem proxy settings. An edge proxy directly
in front of the solo service counts as one hop.

**Upgrading.** An existing one-proxy installation can omit the hop count.
Review its trusted addresses because Postmodem now enforces them. Replace any
adapter-node `ADDRESS_HEADER` / `XFF_DEPTH` settings with the Postmodem settings.
Sign in as an administrator with `admin.config` through the public URL and open
`/admin/client-address` to see the address the board uses for bans and rate
limits. Compare it with the client's IP as seen at the public edge.

## Your own image

```bash
docker build --target runtime -t postmodem:local .
```

then `--image postmodem:local` for the installer, or `POSTMODEM_IMAGE=postmodem:local` in `.env`.

## Next

- [configure.md](configure.md): the settings a board starts with
- [administer.md](administer.md): the command line, backups, upgrades
- Going public: invite-only registration, the privacy notice and backups, in
  [administer.md](administer.md#before-going-public)
