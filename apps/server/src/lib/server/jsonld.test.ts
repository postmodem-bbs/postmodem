// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from "vitest";
import { jsonLdTag } from "./jsonld.ts";

it("embeds JSON that no title can break out of", () => {
  const data = { headline: "</script><script>alert(1)</script>", text: "<!-- x" };
  const tag = jsonLdTag(data);
  expect(tag.match(/<\/script>/g)).toHaveLength(1);
  expect(tag.match(/</g)).toHaveLength(2);
  const json = tag.slice(tag.indexOf(">") + 1, tag.lastIndexOf("<"));
  expect(JSON.parse(json)).toEqual(data);
});
