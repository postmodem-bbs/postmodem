// SPDX-License-Identifier: AGPL-3.0-or-later
// Dates in the reader's time zone and date format (#129).
import { describe, expect, it } from "vitest";
import { type DateFormat, formatDate, formatDateTime } from "./format.ts";

const at = Date.parse("2026-11-23T23:30:00Z");
const f = (over: Partial<DateFormat>): DateFormat => ({
  locale: "en",
  timeZone: "UTC",
  style: "medium",
  ...over,
});

describe("formatDateTime", () => {
  it("writes the time in the reader's time zone", () => {
    expect(formatDateTime(at, f({}))).toBe("Nov 23, 2026, 11:30 PM");
    // Already the next day in Warsaw (UTC+1 in November).
    expect(formatDateTime(at, f({ timeZone: "Europe/Warsaw" }))).toBe("Nov 24, 2026, 12:30 AM");
    expect(formatDate(at, f({ timeZone: "Europe/Warsaw" }))).toBe("Nov 24, 2026");
  });

  it("follows the locale and the chosen style", () => {
    expect(formatDate(at, f({ locale: "pl", style: "long" }))).toBe("23 listopada 2026");
    expect(formatDate(at, f({ locale: "pl", style: "short" }))).toBe("23.11.2026");
    expect(formatDateTime(at, f({ locale: "pl", style: "iso", timeZone: "Europe/Warsaw" }))).toBe(
      "2026-11-24 00:30",
    );
    expect(formatDate(at, f({ style: "iso" }))).toBe("2026-11-23");
  });
});
