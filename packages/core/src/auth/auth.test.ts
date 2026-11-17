// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { disallowedUsernames } from "../core-settings.ts";
import { hashPassword, legacyScheme, passwordProblem, phpassHash, verifyPassword } from "./passwords.ts";
import { Throttle } from "./throttle.ts";
import { cleanUsername, emailProblem, isDisallowed, skeleton, usernameProblem } from "./usernames.ts";

const md5hex = (s: string) => createHash("md5").update(s).digest("hex");

describe("passwords", () => {
  it("hashes with Argon2id in PHC format and verifies", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.scheme).toBe("argon2id");
    expect(h.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(await verifyPassword("correct horse battery", h.scheme, h.hash)).toEqual({
      ok: true,
      needsRehash: false,
    });
    expect((await verifyPassword("correct horse batterY", h.scheme, h.hash)).ok).toBe(false);
    expect((await hashPassword("correct horse battery")).hash).not.toBe(h.hash); // salted
  });

  it("asks for a rehash when stored parameters are weaker than today's", async () => {
    const weak = "$argon2id$v=19$m=4096,t=1,p=1$c29tZXNhbHRzb21lc2FsdA$";
    const { argon2 } = await import("node:crypto");
    const key = await new Promise<Buffer>((res, rej) =>
      argon2(
        "argon2id",
        {
          message: "pw-1234567890",
          nonce: Buffer.from("somesaltsomesalt"),
          memory: 4096,
          passes: 1,
          parallelism: 1,
          tagLength: 32,
        },
        (e, k) => (e ? rej(e) : res(k)),
      ),
    );
    const stored = weak + key.toString("base64").replace(/=+$/, "");
    expect(await verifyPassword("pw-1234567890", "argon2id", stored)).toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it("verifies phpBB2 MD5 hashes, including magic-quoted passwords, and always asks for a rehash", async () => {
    expect(await verifyPassword("hunter2", "phpbb2-md5", md5hex("hunter2"))).toEqual({
      ok: true,
      needsRehash: true,
    });
    expect((await verifyPassword("hunter3", "phpbb2-md5", md5hex("hunter2"))).ok).toBe(false);
    // Stored by a board running with magic_quotes_gpc: O\'Reilly
    expect((await verifyPassword("O'Reilly", "phpbb2-md5", md5hex("O\\'Reilly"))).ok).toBe(true);
  });

  it("verifies phpass portable hashes (Przemo's $H$) against the reference vector", async () => {
    const reference = "$P$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0"; // phpass test.php
    expect(phpassHash("test12345", reference)).toBe(reference);
    expect(await verifyPassword("test12345", "phpass", reference)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword("test12346", "phpass", reference)).ok).toBe(false);
    // Przemo/phpBB3 write the same algorithm with a $H$ label; the label isn't hashed.
    const przemo = `$H$${reference.slice(3)}`;
    expect((await verifyPassword("test12345", "phpass", przemo)).ok).toBe(true);
  });

  it("recognises legacy hash formats", () => {
    expect(legacyScheme(md5hex("x"))).toBe("phpbb2-md5");
    expect(legacyScheme("$H$9IQRaTwmfeRo7ud9Fh4E2PdI0S3r.L0")).toBe("phpass");
    expect(legacyScheme("plaintext")).toBeNull();
  });

  it("only cares about length, and refuses the user's own name", () => {
    expect(passwordProblem("short")).toBe("too-short");
    expect(passwordProblem("zażółć gęś")).toBeNull(); // 10 code points
    expect(passwordProblem("x".repeat(1025))).toBe("too-long");
    expect(passwordProblem("Łukasz Żółć", ["łukasz żółć"])).toBe("same-as-name");
    expect(passwordProblem("aaaaaaaaaa")).toBeNull(); // no composition rules (NIST 800-63B)
  });
});

describe("usernames", () => {
  const disallowed = disallowedUsernames.default;
  it("accepts ordinary names in any single script", () => {
    for (const n of ["Ola", "Łukasz Żółć", "retro_fan", "Ёжик", "Αθηνά", "山田太郎", "やまだ", "user.42"])
      expect(usernameProblem(n, disallowed), n).toBeNull();
  });

  it("rejects bad lengths, characters, edges and mixed scripts", () => {
    expect(usernameProblem("a")).toBe("too-short");
    expect(usernameProblem("a".repeat(26))).toBe("too-long");
    expect(usernameProblem("<script>")).toBe("characters");
    expect(usernameProblem("ola@example")).toBe("characters");
    expect(usernameProblem("_ola")).toBe("edges");
    expect(usernameProblem("o..la")).toBe("edges");
    expect(usernameProblem("pаypal")).toBe("mixed-scripts"); // Cyrillic а
  });

  it("folds lookalikes into one skeleton", () => {
    expect(skeleton("Admin")).toBe(skeleton("АDMIN")); // Cyrillic А
    expect(skeleton("ola")).toBe(skeleton("o1a"));
    expect(skeleton("modern")).toBe(skeleton("modem"));
    expect(skeleton("retro_fan")).toBe(skeleton("retrofan"));
    expect(skeleton("Łukasz")).toBe(skeleton("Lukasz"));
    expect(skeleton("Ola")).not.toBe(skeleton("Ala"));
  });

  it("applies phpBB2-style disallow patterns, wildcards and lookalikes", () => {
    expect(isDisallowed("Administrator", disallowed)).toBe(true);
    expect(isDisallowed("admin_team", disallowed)).toBe(true);
    expect(isDisallowed("r00t", disallowed)).toBe(true); // lookalike of a plain entry
    expect(isDisallowed("Gość", disallowed)).toBe(true);
    expect(isDisallowed("Ola", disallowed)).toBe(false);
    expect(usernameProblem("Moderator Ola", disallowed)).toBe("disallowed");
  });

  it("cleans input and checks e-mail shape", () => {
    expect(cleanUsername("  Ola   Nowak ")).toBe("Ola Nowak");
    expect(emailProblem("ola@example.org")).toBeNull();
    expect(emailProblem("ola@localhost")).toBe("invalid");
    expect(emailProblem("not an email")).toBe("invalid");
  });
});

describe("throttle", () => {
  it("allows free attempts, then doubles the delay, and forgets after the window", () => {
    const t = new Throttle({ free: 2, baseMs: 1000, maxMs: 8000, windowMs: 60_000 });
    let now = 0;
    t.fail("k", now);
    expect(t.wait("k", now)).toBe(0);
    t.fail("k", now);
    expect(t.wait("k", now)).toBe(1000);
    t.fail("k", now);
    expect(t.wait("k", now)).toBe(2000);
    for (let i = 0; i < 10; i++) t.fail("k", now);
    expect(t.wait("k", now)).toBe(8000); // capped
    now += 8000;
    expect(t.wait("k", now)).toBe(0);
    expect(t.wait("other", now)).toBe(0);
    now += 61_000;
    t.fail("k", now);
    expect(t.wait("k", now)).toBe(0); // window passed: counting starts again
    t.reset("k");
    expect(t.wait("k", now)).toBe(0);
  });

  it("bounds memory", () => {
    const t = new Throttle({ free: 0, baseMs: 1000, maxMs: 1000, windowMs: 60_000 }, 3);
    for (const k of ["a", "b", "c", "d"]) t.fail(k, 0);
    expect(t.wait("a", 0)).toBe(0); // evicted
    expect(t.wait("d", 0)).toBe(1000);
  });
});
