#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Postmodem installer (#164): from nothing to a running board, solo or stack, or a demo board.
#
#   curl -fsSL https://raw.githubusercontent.com/postmodem-bbs/postmodem/main/deploy/install.sh | sh
#   sh deploy/install.sh --solo --demo          (from a checkout)
#
# It asks for what it needs (or takes flags with --yes), writes .env and the stack's secrets,
# starts the board with Docker Compose and creates the first administrator. Safe to run again:
# it never overwrites .env, secrets, compose files or data. Run with --help for the options.
set -eu

REPO=postmodem-bbs/postmodem
IMAGE_REPO=ghcr.io/postmodem-bbs/postmodem
FILES="compose.yaml compose.solo.yaml compose.reverse-proxy.yaml .env.example caddy/Caddyfile"

mode="" dir="" version="" image="" url="" domain="" mail_url="" port="" demo=0 yes=0
admin_name="" admin_email=""

usage() {
  cat <<'EOF'
Postmodem installer

Usage: install.sh [options]

  --solo | --stack     one container with SQLite (default), or Postgres + Caddy (HTTPS)
  --demo               a demo board: demo content, every account's password is postmodem-demo
  --dir <path>         where the board's files go (default: ./postmodem, or deploy/ itself
                       when run from a checkout)
  --version <v>        a release (e.g. 0.2.0) or "edge" (the latest build of main);
                       default: the latest release (edge when run from a checkout)
  --image <ref>        a specific image instead (e.g. postmodem:local)
  --url <url>          the board's public address (solo default: http://localhost:<port>)
  --port <n>           solo: the port on this machine (default 8080)
  --domain <name>      stack: the domain Caddy gets a certificate for
  --mail-url <url>     smtp://user:pass@host:587 to send e-mail (default log://: the log only)
  --admin-name <name>  the first administrator (default admin); not with --demo
  --admin-email <addr> their e-mail address; the password is asked for, or read from
                       POSTMODEM_ADMIN_PASSWORD
  --yes                don't ask; use the flags and defaults
  -h, --help           this help
EOF
}

say() { printf '%s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
need_value() { if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value"; fi; }

while [ $# -gt 0 ]; do
  case $1 in
    --solo) mode=solo ;;
    --stack) mode=stack ;;
    --demo) demo=1 ;;
    --yes | -y) yes=1 ;;
    --dir) need_value "$@"; dir=$2; shift ;;
    --version) need_value "$@"; version=$2; shift ;;
    --image) need_value "$@"; image=$2; shift ;;
    --url) need_value "$@"; url=$2; shift ;;
    --port) need_value "$@"; port=$2; shift ;;
    --domain) need_value "$@"; domain=$2; shift ;;
    --mail-url) need_value "$@"; mail_url=$2; shift ;;
    --admin-name) need_value "$@"; admin_name=$2; shift ;;
    --admin-email) need_value "$@"; admin_email=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

# ── asking ──────────────────────────────────────────────────────────────────────────────────
# Questions go to the terminal even when the script itself comes from a pipe (curl | sh).
interactive=0
if [ "$yes" = 0 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then interactive=1; fi

# ask <variable> <question> <default>: keeps a value set by a flag; else asks, or takes the default.
ask() {
  eval "current=\${$1}"
  [ -n "$current" ] && return 0
  answer=""
  if [ "$interactive" = 1 ]; then
    printf '%s [%s]: ' "$2" "$3" >/dev/tty
    IFS= read -r answer </dev/tty || answer=""
  fi
  [ -n "$answer" ] || answer=$3
  eval "$1=\$answer"
}

ask_secret() {
  answer=""
  [ "$interactive" = 1 ] || return 0
  printf '%s: ' "$1" >/dev/tty
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r answer </dev/tty || answer=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
}

# ── prerequisites ───────────────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is needed: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is needed (the 'docker compose' command)"

fetch() { # fetch <url> <file>
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else die "curl or wget is needed to download the compose files"; fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 48 | tr -d '\n'
  else head -c 48 /dev/urandom | base64 | tr -d '\n'; fi
}

# Run from a checkout (sh deploy/install.sh), the compose files are right beside the script.
src=""
case $0 in
  */install.sh | install.sh)
    here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
    [ -f "$here/compose.solo.yaml" ] && src=$here
    ;;
esac

# ── what to install ─────────────────────────────────────────────────────────────────────────
ask mode "Solo (one container, SQLite) or stack (Postgres, HTTPS)? solo/stack" solo
case $mode in solo | stack) ;; *) die "--solo or --stack, not '$mode'" ;; esac

if [ -z "$version" ] && [ -z "$image" ]; then
  if [ -n "$src" ]; then version=edge
  else
    version=$(fetch "https://api.github.com/repos/$REPO/releases/latest" /dev/stdout 2>/dev/null |
      sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1) || true
    [ -n "$version" ] || die "couldn't find the latest release; pass --version (e.g. edge)"
  fi
fi
version=${version#v}
[ -n "$image" ] || image="$IMAGE_REPO:$version"
case $version in edge | "") ref=main ;; *) ref="v$version" ;; esac

[ -n "$dir" ] || { if [ -n "$src" ]; then dir=$src; else dir=./postmodem; fi; }
mkdir -p "$dir"
dir=$(CDPATH='' cd -- "$dir" && pwd)

# The compose files: copied from the checkout, or downloaded for that version. Existing ones
# stay as they are (they may have local changes).
for f in $FILES; do
  [ -e "$dir/$f" ] && continue
  mkdir -p "$dir/$(dirname "$f")"
  if [ -n "$src" ]; then cp "$src/$f" "$dir/$f"
  else fetch "https://raw.githubusercontent.com/$REPO/$ref/deploy/$f" "$dir/$f" || die "couldn't download $f for $ref"; fi
done

if [ "$mode" = solo ]; then
  ask port "Port on this machine" 8080
  ask url "Public address" "http://localhost:$port"
else
  ask domain "Domain for the board (Caddy gets its certificate)" localhost
  ask url "Public address" "https://$domain"
fi
ask mail_url "Outgoing mail (smtp://user:pass@host:587, or log:// for the log only)" "log://"

# ── .env and secrets ────────────────────────────────────────────────────────────────────────
umask 077
if [ -e "$dir/.env" ]; then
  say "Keeping the existing $dir/.env."
  if [ "$demo" = 1 ] && ! grep -q '^POSTMODEM_DEMO=1' "$dir/.env"; then
    say "  (it doesn't set POSTMODEM_DEMO=1; the demo is set up with 'postmodem demo' instead)"
  fi
else
  {
    say "# Written by install.sh. Change it, then run 'docker compose up -d' again."
    say "POSTMODEM_IMAGE=$image"
    say "POSTMODEM_PUBLIC_URL=$url"
    if [ "$mode" = solo ]; then say "POSTMODEM_HTTP_PORT=$port"; else say "POSTMODEM_DOMAIN=$domain"; fi
    say "POSTMODEM_MAIL_URL=$mail_url"
    if [ "$demo" = 1 ]; then say "# A demo board: every demo account's password is postmodem-demo."; say "POSTMODEM_DEMO=1"; fi
  } >"$dir/.env"
  say "Wrote $dir/.env."
fi

if [ "$mode" = stack ]; then
  mkdir -p "$dir/secrets"
  chmod 700 "$dir/secrets"
  for s in db_password secret_key; do
    [ -s "$dir/secrets/$s" ] && continue
    random_secret >"$dir/secrets/$s"
    # Readable by the board's user inside the container; the folder keeps others out.
    chmod 644 "$dir/secrets/$s"
    say "Generated $dir/secrets/$s."
  done
fi
umask 022

# ── start ───────────────────────────────────────────────────────────────────────────────────
cd "$dir"
if [ "$mode" = solo ]; then
  compose() { docker compose -f compose.solo.yaml "$@"; }
  role=postmodem
else
  compose() { docker compose "$@"; }
  role=web
fi
postmodem() { compose exec -T "$role" /nodejs/bin/node /app/postmodem.js "$@"; }

say "Starting the board ($mode, $image)…"
if [ "$mode" = solo ]; then
  compose up -d --wait
else
  compose up -d --wait web worker scheduler
  compose up -d proxy
fi

if [ "$demo" = 1 ]; then
  out=$(postmodem demo 2>&1) || {
    printf '%s\n' "$out" >&2
    die "this image can't set up a demo board ('postmodem demo' needs a newer version; try --version edge)"
  }
  # The board seeded itself on start (POSTMODEM_DEMO); `demo` made sure of the passwords.
  say ""
  say "The demo board is ready."
  printf '%s\n' "$out" | grep -v -e '^{' -e '^demo board'
else
  ask admin_name "First administrator's username" admin
  ask admin_email "Their e-mail address" ""
  password=${POSTMODEM_ADMIN_PASSWORD:-}
  [ -n "$password" ] || { ask_secret "Their password (at least 10 characters)"; password=$answer; }
  if [ -n "$admin_email" ] && [ -n "$password" ]; then
    # The password goes in on stdin, never in an environment variable or on a command line.
    printf '%s' "$password" | compose exec -T \
      -e POSTMODEM_ADMIN_USERNAME="$admin_name" -e POSTMODEM_ADMIN_EMAIL="$admin_email" \
      -e POSTMODEM_ADMIN_PASSWORD_FILE=/dev/stdin \
      "$role" /nodejs/bin/node /app/postmodem.js init >/dev/null ||
      die "couldn't create the administrator; run init yourself (docs/guide)"
    say "Administrator: $admin_name."
  else
    say "No administrator created (no e-mail address or password). Later, from $dir:"
    say "  docker compose$([ "$mode" = solo ] && printf ' -f compose.solo.yaml') exec -e POSTMODEM_ADMIN_EMAIL=you@example.org -e POSTMODEM_ADMIN_PASSWORD_FILE=/dev/stdin -T $role /nodejs/bin/node /app/postmodem.js init"
  fi
fi

say ""
say "Postmodem is running at $url"
say "Its files are in $dir. From there:"
say "  docker compose$([ "$mode" = solo ] && printf ' -f compose.solo.yaml') logs -f      # the log (and, with log://, the e-mails)"
say "  docker compose$([ "$mode" = solo ] && printf ' -f compose.solo.yaml') down         # stop it (the data stays in its volumes)"
