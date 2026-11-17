// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared by every spec: axe with WCAG 2.2 AA tags, and a guard that fails any test whose page
// logged a Content Security Policy violation.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export function guardCsp() {
  test.beforeEach(async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    (page as Page & { cspViolations: string[] }).cspViolations = violations;
  });
  test.afterEach(async ({ page }) => {
    expect((page as Page & { cspViolations?: string[] }).cspViolations ?? []).toEqual([]);
  });
}
