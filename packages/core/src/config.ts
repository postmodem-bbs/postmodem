// SPDX-License-Identifier: AGPL-3.0-or-later
// Infrastructure configuration (CONTAINERS.md §3).
// Precedence: defaults → <dataDir>/postmodem.toml → POSTMODEM_* env → POSTMODEM_*_FILE env.
// Infrastructure settings are never editable from the browser.
import { parse as parseToml } from "smol-toml";
import { z } from "zod";

const ENV_PREFIX = "POSTMODEM_";

/** One entry per configuration key: how to read it and whether it is secret. */
const FIELDS = {
  publicUrl: { env: "PUBLIC_URL", toml: "public_url", secret: false },
  host: { env: "HOST", toml: "host", secret: false },
  port: { env: "PORT", toml: "port", secret: false },
  databaseUrl: { env: "DATABASE_URL", toml: "database_url", secret: false },
  searchUrl: { env: "SEARCH_URL", toml: "search_url", secret: false },
  searchKey: { env: "SEARCH_KEY", toml: "search_key", secret: true },
  databasePassword: { env: "DATABASE_PASSWORD", toml: "database_password", secret: true },
  secretKey: { env: "SECRET_KEY", toml: "secret_key", secret: true },
  trustedProxies: { env: "TRUSTED_PROXIES", toml: "trusted_proxies", secret: false },
  proxyHops: { env: "PROXY_HOPS", toml: "proxy_hops", secret: false },
  logLevel: { env: "LOG_LEVEL", toml: "log_level", secret: false },
  sourceUrl: { env: "SOURCE_URL", toml: "source_url", secret: false },
  // Shown with any password redacted (redactUrl), so not marked secret as a whole.
  mailUrl: { env: "MAIL_URL", toml: "mail_url", secret: false },
  mailFrom: { env: "MAIL_FROM", toml: "mail_from", secret: false },
  registrationsPerIpHour: {
    env: "REGISTRATIONS_PER_IP_HOUR",
    toml: "registrations_per_ip_hour",
    secret: false,
  },
  profile: { env: "PROFILE", toml: "profile", secret: false },
  // Valkey for counters and live updates (the `scale` profile); passwords shown redacted.
  countersUrl: { env: "COUNTERS_URL", toml: "counters_url", secret: false },
  realtimeUrl: { env: "REALTIME_URL", toml: "realtime_url", secret: false },
} as const;
type FieldName = keyof typeof FIELDS;

/** Variables we know about but that belong to later milestones; accepted, not yet used. */
const RESERVED = new Set([
  "DATA_DIR",
  "VERSION",
  "REVISION",
  "CACHE_URL",
  "QUEUE",
  "STORAGE_URL",
  "AV_URL",
  "EXTENSIONS",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
]);

const ConfigSchema = z.object({
  dataDir: z.string().min(1),
  publicUrl: z.url({ protocol: /^https?$/ }),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  databaseUrl: z
    .string()
    .regex(/^(sqlite|postgres|postgresql):\/\//, "must start with sqlite:// or postgres://"),
  searchUrl: z.union([
    z.literal("builtin://"),
    z.url({ protocol: /^meilisearchs?$/ }).refine((value) => {
      const url = new URL(value);
      return (
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^\/?[a-zA-Z0-9_-]*$/.test(url.pathname)
      );
    }, "use meilisearch://host[:port][/index] or meilisearchs:// for TLS"),
  ]),
  searchKey: z.string().optional(),
  databasePassword: z.string().optional(),
  secretKey: z.string().min(32, "must be at least 32 characters").optional(),
  trustedProxies: z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])),
  proxyHops: z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(0).max(32)),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  sourceUrl: z.url().optional(),
  mailUrl: z.string().regex(/^(log|smtps?):\/\//, "must start with log://, smtp:// or smtps://"),
  /** Sender address; defaults to noreply@<public host>. */
  mailFrom: z.string().optional(),
  /** Registrations one IP address can make per hour before delays start; 0 = unlimited. */
  registrationsPerIpHour: z.coerce.number().int().min(0),
  profile: z.enum(["vanilla", "essentials", "przemo"]),
  /** Counters' buffer: memory:// (each process, the default) or a shared Valkey. */
  countersUrl: z
    .string()
    .regex(/^(memory:\/\/|(valkeys?|rediss?):\/\/)/, "must be memory:// or start with valkey:// or redis://")
    .optional(),
  /**
   * Live updates between processes: memory:// (one process), postgres:// (LISTEN/NOTIFY on the
   * board's database) or Valkey. Unset: postgres:// on Postgres, memory:// on SQLite.
   */
  realtimeUrl: z
    .string()
    .regex(
      /^(memory:\/\/|postgres:\/\/|(valkeys?|rediss?):\/\/)/,
      "must be memory://, postgres://, or start with valkey:// or redis://",
    )
    .optional(),
  version: z.string(),
  revision: z.string(),
});
export type Config = z.infer<typeof ConfigSchema>;
export type ConfigSource = "default" | "file" | "env" | "env-file";

export interface LoadedConfig {
  config: Config;
  sources: Record<string, ConfigSource>;
  warnings: string[];
}

export interface ConfigIo {
  env: Record<string, string | undefined>;
  readFile: (path: string) => string | undefined;
}

export class ConfigError extends Error {}

export function loadConfig(io: ConfigIo): LoadedConfig {
  const env = io.env;
  const warnings: string[] = [];
  const dataDir = env[`${ENV_PREFIX}DATA_DIR`] ?? "/data";

  const raw: Record<string, unknown> = {
    dataDir,
    publicUrl: "http://localhost:8080",
    host: "0.0.0.0",
    port: 8080,
    databaseUrl: `sqlite://${dataDir}/db/postmodem.sqlite`,
    searchUrl: "builtin://",
    trustedProxies: [],
    proxyHops: undefined,
    logLevel: "info",
    mailUrl: "log://",
    registrationsPerIpHour: 10,
    profile: "essentials",
    version: env[`${ENV_PREFIX}VERSION`] ?? "0.0.0-dev",
    revision: env[`${ENV_PREFIX}REVISION`] ?? "unknown",
  };
  const sources: Record<string, ConfigSource> = Object.fromEntries(
    Object.keys(raw).map((k) => [k, "default"]),
  );
  if (env[`${ENV_PREFIX}DATA_DIR`]) sources.dataDir = "env";

  // 1. optional TOML file
  const tomlPath = `${dataDir}/postmodem.toml`;
  const tomlText = io.readFile(tomlPath);
  if (tomlText !== undefined) {
    let toml: Record<string, unknown>;
    try {
      toml = parseToml(tomlText) as Record<string, unknown>;
    } catch (e) {
      throw new ConfigError(`${tomlPath}: ${(e as Error).message}`);
    }
    const known = new Map<string, FieldName>(
      Object.entries(FIELDS).map(([name, f]) => [f.toml, name as FieldName]),
    );
    for (const [key, value] of Object.entries(toml)) {
      const name = known.get(key);
      if (!name) {
        warnings.push(`${tomlPath}: unknown key '${key}' ignored`);
        continue;
      }
      raw[name] = value;
      sources[name] = "file";
    }
  }

  // 2. environment, then 3. *_FILE (Docker/Compose secrets)
  for (const [name, f] of Object.entries(FIELDS) as [FieldName, (typeof FIELDS)[FieldName]][]) {
    const direct = env[ENV_PREFIX + f.env];
    if (direct !== undefined && direct !== "") {
      raw[name] = name === "trustedProxies" ? splitList(direct) : direct;
      sources[name] = "env";
    }
    const filePath = env[`${ENV_PREFIX}${f.env}_FILE`];
    if (filePath) {
      const content = io.readFile(filePath);
      if (content === undefined)
        throw new ConfigError(`${ENV_PREFIX}${f.env}_FILE points to ${filePath}, which can't be read`);
      raw[name] = name === "trustedProxies" ? splitList(content) : content.trim();
      sources[name] = "env-file";
    }
  }

  // Unknown POSTMODEM_* variables are almost always typos.
  const knownEnv = new Set<string>([...Object.values(FIELDS).map((f) => f.env), ...RESERVED]);
  for (const key of Object.keys(env)) {
    if (!key.startsWith(ENV_PREFIX)) continue;
    const bare = key.slice(ENV_PREFIX.length).replace(/_FILE$/, "");
    if (!knownEnv.has(bare)) {
      const hint = [...knownEnv].find((k) => distance(k, bare) <= 2);
      warnings.push(`unknown variable ${key}${hint ? ` (did you mean ${ENV_PREFIX}${hint}?)` : ""}`);
    }
  }

  // Existing one-proxy deployments can keep their trusted list and omit a hop count.
  raw.proxyHops ??= Array.isArray(raw.trustedProxies) && raw.trustedProxies.length ? 1 : 0;
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => {
      const name = String(i.path[0]);
      const f = FIELDS[name as FieldName];
      const where = f ? `${ENV_PREFIX}${f.env} (from ${sources[name] ?? "default"})` : name;
      return `${where}: ${i.message}`;
    });
    throw new ConfigError(`invalid configuration:\n  ${lines.join("\n  ")}`);
  }
  const config = parsed.data;
  if (config.proxyHops > 0 && config.trustedProxies.length === 0)
    throw new ConfigError(
      `invalid configuration:\n  POSTMODEM_PROXY_HOPS (from ${sources.proxyHops}): requires POSTMODEM_TRUSTED_PROXIES when greater than zero`,
    );
  return { config, sources, warnings };
}

/** Effective configuration for `postmodem config print`, secrets redacted. */
export function describeConfig(
  loaded: LoadedConfig,
): Record<string, { value: unknown; source: ConfigSource }> {
  const out: Record<string, { value: unknown; source: ConfigSource }> = {};
  for (const [key, value] of Object.entries(loaded.config)) {
    const secret = FIELDS[key as FieldName]?.secret ?? false;
    const shown = secret && value !== undefined ? "••••••" : redactUrl(value);
    out[key] = { value: shown, source: loaded.sources[key] ?? "default" };
  }
  return out;
}

function redactUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/(\/\/[^:/@]*:)[^@]+@/, "$1••••••@");
}

function splitList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length]![b.length]!;
}
