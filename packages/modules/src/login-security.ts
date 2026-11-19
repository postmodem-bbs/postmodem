// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  defineSetting,
  type LoginAttempt,
  PASSWORD_MIN,
  type PackageDefinition,
  Throttle,
  tokenHash,
} from "@postmodem/core";
import { z } from "zod";

const integer = (key: string, min: number, max: number, value: number) =>
  defineSetting({ key: `login-security.auth.${key}`, schema: z.int().min(min).max(max), default: value });
const toggle = (key: string) =>
  defineSetting({ key: `login-security.auth.${key}`, schema: z.boolean(), default: false });

export const loginSecuritySettings = {
  maxFailures: integer("maxFailures", 0, 100, 5),
  blockMinutes: integer("blockMinutes", 0, 1440, 1),
  minPasswordLength: integer("minPasswordLength", PASSWORD_MIN, 128, PASSWORD_MIN),
  requireLettersAndNumbers: toggle("requireLettersAndNumbers"),
  bindSessionIp: toggle("bindSessionIp"),
};

const attemptKey = ({ identifier, ip }: LoginAttempt) => tokenHash(JSON.stringify([identifier, ip]));

export const loginSecurity: PackageDefinition = {
  key: "login-security",
  name: "Login security",
  description: "Configurable login cooldown, password requirements and optional session IP binding.",
  tier: 2,
  version: "0.1.0",
  settings: Object.values(loginSecuritySettings),
  setup({ repos, settings }) {
    const { maxFailures, blockMinutes, minPasswordLength, requireLettersAndNumbers, bindSessionIp } =
      loginSecuritySettings;
    const throttle = () => {
      const free = settings.get(maxFailures);
      const block = settings.get(blockMinutes) * 60_000;
      if (!free || !block) return undefined;
      return new Throttle(
        { free, baseMs: block, maxMs: block, windowMs: block },
        repos.throttle,
        "login-security",
      );
    };
    return {
      auth: {
        beforeLogin: (attempt) => throttle()?.wait(attemptKey(attempt), attempt.now) ?? 0,
        async afterLoginFailure(attempt) {
          await throttle()?.fail(attemptKey(attempt), attempt.now);
        },
        async afterLoginSuccess(attempt) {
          await throttle()?.reset(attemptKey(attempt));
        },
        passwordPolicy(password) {
          if ([...password].length < settings.get(minPasswordLength)) return "package-min-length";
          if (
            settings.get(requireLettersAndNumbers) &&
            !(/\p{L}/u.test(password) && /\p{Nd}/u.test(password))
          )
            return "letters-and-numbers";
        },
        validateSession: (session, ip) => !settings.get(bindSessionIp) || session.ip === ip,
      },
    };
  },
};
