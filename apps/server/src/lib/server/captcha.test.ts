// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeAnswer, issueChallenge, NO_JS_WAIT_MS, verifyAnswer } from "./captcha.ts";

const SECRET = "test-secret";
function memoryStore() {
  const m = new Map<string, { failures: number; last: number }>();
  return {
    get: async (k: string) => m.get(k),
    put: async (k: string, failures: number, last: number) => void m.set(k, { failures, last }),
    remove: async (k: string) => void m.delete(k),
    purge: async () => 0,
  };
}
const solve = (c: ReturnType<typeof issueChallenge>) => {
  for (let n = 0; n <= c.max; n++)
    if (createHash("sha256").update(`${c.salt}${n}`).digest("hex") === c.challenge) return n;
  throw new Error("no solution");
};

describe("proof-of-work captcha", () => {
  it("accepts a solved challenge once, and refuses forged, expired and wrong answers", async () => {
    const store = memoryStore();
    const now = 1_000_000;
    const c = issueChallenge(SECRET, now);
    const n = solve(c);
    expect(await verifyAnswer(SECRET, encodeAnswer(c, n), store, now + 1000)).toBe("ok");
    expect(await verifyAnswer(SECRET, encodeAnswer(c, n), store, now + 2000)).toBe("reused");
    const c2 = issueChallenge(SECRET, now);
    expect(await verifyAnswer(SECRET, encodeAnswer(c2, (solve(c2) + 1) % c2.max), store, now)).toBe(
      "invalid",
    );
    expect(await verifyAnswer("other-secret", encodeAnswer(c2, solve(c2)), store, now)).toBe("invalid");
    expect(await verifyAnswer(SECRET, encodeAnswer({ ...c2, challenge: "00" }, 1), store, now)).toBe(
      "invalid",
    );
    expect(await verifyAnswer(SECRET, encodeAnswer(c2, solve(c2)), store, c2.expires + 1)).toBe("expired");
    expect(await verifyAnswer(SECRET, null, store, now)).toBe("missing");
    expect(await verifyAnswer(SECRET, "not base64 json", store, now)).toBe("invalid");
  });

  it("lets forms without JavaScript through after a short wait", async () => {
    const store = memoryStore();
    const c = issueChallenge(SECRET, 0);
    expect(await verifyAnswer(SECRET, encodeAnswer(c, null), store, NO_JS_WAIT_MS - 1)).toBe("too-fast");
    expect(await verifyAnswer(SECRET, encodeAnswer(c, null), store, NO_JS_WAIT_MS)).toBe("ok");
  });
});
