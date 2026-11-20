// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, it } from "vitest";
import { quoteSource } from "./posting.ts";

it("quotes without revealing hidden content or breaking out of the quote tag", () => {
  expect(quoteSource("Ola", "Cześć [hide]tajne[/hide] wszystkim")).toBe(
    '[quote="Ola"]Cześć  wszystkim[/quote]\n',
  );
  expect(quoteSource("A", "before [hide]outer [hide]inner[/hide] tail[/hide] after")).toBe(
    '[quote="A"]before  after[/quote]\n',
  );
  expect(quoteSource('Zły"]nick', "x")).toBe('[quote="Złynick"]x[/quote]\n');
  expect(quoteSource("A", "[HIDE]\nlinia\n[/HIDE]")).toBe('[quote="A"][/quote]\n');
});
