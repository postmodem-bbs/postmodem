// SPDX-License-Identifier: AGPL-3.0-or-later
// E-mailing a member through the board (#132).
import { describe, expect, it } from "vitest";
import type { Permissions } from "./core-permissions.ts";
import { memberMailProblem, reachableByMail } from "./member-mail.ts";
import type { User } from "./types.ts";

const user = (id: number, over: Partial<User> = {}): User =>
  ({
    id,
    username: `u${id}`,
    email: `u${id}@example.org`,
    status: "active",
    origin: "local",
    postCount: 10,
    allowEmail: true,
    ...over,
  }) as User;
const perms = (allowed: string[]): Permissions =>
  ({ can: (c: string) => allowed.includes(c) }) as unknown as Permissions;
const member = perms(["pm.send"]);
const input = { subject: "  Amiga 500  ", body: "Is it still for sale?\r\n" };
const rules = { boardAllows: true, newMemberPosts: 3 };

describe("member e-mail (#132)", () => {
  it("goes only to members who allow it and have an address", () => {
    expect(reachableByMail(user(2), true)).toBe(true);
    expect(reachableByMail(user(2), false)).toBe(false);
    expect(reachableByMail(user(2, { allowEmail: false }), true)).toBe(false);
    expect(reachableByMail(user(2, { email: null }), true)).toBe(false);
    expect(reachableByMail(user(2, { status: "banned" as User["status"] }), true)).toBe(false);
  });

  it("checks the sender, the recipient and the message", () => {
    expect(memberMailProblem(user(1), user(2), member, input, rules)).toEqual({
      subject: "Amiga 500",
      body: "Is it still for sale?",
    });
    expect(memberMailProblem(user(1), user(2), member, input, { ...rules, boardAllows: false })).toBe(
      "disabled",
    );
    expect(memberMailProblem(null, user(2), member, input, rules)).toBe("sign-in");
    expect(memberMailProblem(user(1), user(2), perms([]), input, rules)).toBe("forbidden");
    expect(memberMailProblem(user(1), user(2, { allowEmail: false }), member, input, rules)).toBe(
      "recipient",
    );
    expect(memberMailProblem(user(1), undefined, member, input, rules)).toBe("recipient");
    expect(memberMailProblem(user(1), user(1), member, input, rules)).toBe("self");
    expect(memberMailProblem(user(1), user(2), member, { ...input, subject: " " }, rules)).toBe(
      "subject-missing",
    );
    expect(memberMailProblem(user(1), user(2), member, { ...input, body: "\n" }, rules)).toBe("body-missing");
    expect(memberMailProblem(user(1), user(2), member, { ...input, body: "x".repeat(5001) }, rules)).toBe(
      "body-long",
    );
  });

  it("waits for new members' first posts, as private messages do", () => {
    const newbie = user(1, { postCount: 1 });
    expect(memberMailProblem(newbie, user(2), member, input, rules)).toBe("new-member");
    expect(
      memberMailProblem(newbie, user(2), perms(["pm.send", "moderate.edit"]), input, rules),
    ).toHaveProperty("subject");
  });
});
