// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "./config.ts";

const io = (env: Record<string, string>, files: Record<string, string> = {}) => ({
  env,
  readFile: (p: string) => files[p],
});

describe("loadConfig", () => {
  it("uses solo-mode defaults", () => {
    const { config, sources } = loadConfig(io({}));
    expect(config.databaseUrl).toBe("sqlite:///data/db/postmodem.sqlite");
    expect(config.port).toBe(8080);
    expect(sources.port).toBe("default");
  });

  it("applies defaults < toml < env < *_FILE", () => {
    const { config, sources } = loadConfig(
      io(
        {
          POSTMODEM_DATA_DIR: "/srv",
          POSTMODEM_PORT: "9000",
          POSTMODEM_SECRET_KEY_FILE: "/run/secrets/key",
          POSTMODEM_TRUSTED_PROXIES: "10.0.0.0/8, 172.16.0.0/12",
        },
        {
          "/srv/postmodem.toml": 'port = 8081\npublic_url = "https://forum.example.org"',
          "/run/secrets/key": "k".repeat(40),
        },
      ),
    );
    expect(config.port).toBe(9000);
    expect(sources.port).toBe("env");
    expect(config.publicUrl).toBe("https://forum.example.org");
    expect(sources.publicUrl).toBe("file");
    expect(config.secretKey).toBe("k".repeat(40));
    expect(sources.secretKey).toBe("env-file");
    expect(config.trustedProxies).toEqual(["10.0.0.0/8", "172.16.0.0/12"]);
    expect(config.databaseUrl).toBe("sqlite:///srv/db/postmodem.sqlite");
  });

  it("warns about typos in variable names", () => {
    const { warnings } = loadConfig(io({ POSTMODEM_DATABSE_URL: "x" }));
    expect(warnings[0]).toContain("did you mean POSTMODEM_DATABASE_URL");
  });

  it("names the variable and its source when validation fails", () => {
    expect(() => loadConfig(io({ POSTMODEM_PORT: "99999" }))).toThrowError(/POSTMODEM_PORT \(from env\)/);
    expect(() => loadConfig(io({ POSTMODEM_DATABASE_URL: "mysql://x" }))).toThrowError(ConfigError);
  });

  it("fails clearly when a *_FILE can't be read", () => {
    expect(() => loadConfig(io({ POSTMODEM_SECRET_KEY_FILE: "/nope" }))).toThrowError(/can't be read/);
  });

  it("redacts secrets and URL passwords when describing", () => {
    const loaded = loadConfig(
      io({ POSTMODEM_SECRET_KEY: "s".repeat(40), POSTMODEM_DATABASE_URL: "postgres://pm:hunter2@db/pm" }),
    );
    const d = describeConfig(loaded);
    expect(d.secretKey?.value).toBe("••••••");
    expect(d.databaseUrl?.value).toBe("postgres://pm:••••••@db/pm");
  });
});
