// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { ViewCounter } from "./counters.ts";

describe("ViewCounter", () => {
  it("batches views per topic and writes them once per flush", async () => {
    const writes: [number, number][] = [];
    const c = new ViewCounter(async (id, by) => void writes.push([id, by]));
    c.add(1);
    c.add(1);
    c.add(2);
    expect(c.pending(1)).toBe(2);
    await c.flush();
    expect(writes).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(c.pending(1)).toBe(0);
    await c.flush();
    expect(writes).toHaveLength(2);
  });

  it("keeps views whose write failed for the next flush, and counts new ones meanwhile", async () => {
    let fail = true;
    const written = new Map<number, number>();
    const errors: unknown[] = [];
    const c = new ViewCounter(
      async (id, by) => {
        if (fail) throw new Error("database is down");
        written.set(id, (written.get(id) ?? 0) + by);
      },
      (e) => errors.push(e),
    );
    c.add(7);
    const first = c.flush();
    c.add(7);
    await first;
    expect(errors).toHaveLength(1);
    expect(c.pending(7)).toBe(2);
    fail = false;
    await c.flush();
    expect(written.get(7)).toBe(2);
  });
});
