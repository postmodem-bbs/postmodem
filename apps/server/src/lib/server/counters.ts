// SPDX-License-Identifier: AGPL-3.0-or-later
// Topic view counts, write-behind (M1 slice 3, the first user of PACKAGES §1 "Counters"):
// views add up in memory and go to the database in one batch every few seconds and at
// shutdown, so reading a topic never waits for a write. Each replica flushes its own
// increments, which add up correctly. A crash loses at most one interval of views.
import type { Id } from "@postmodem/core";

export const VIEW_FLUSH_MS = 10_000;

export class ViewCounter {
  #pending = new Map<Id, number>();
  #flushing: Promise<void> | undefined;
  readonly #write: (topicId: Id, by: number) => Promise<void>;
  readonly #onError: (e: unknown) => void;

  constructor(write: (topicId: Id, by: number) => Promise<void>, onError: (e: unknown) => void = () => {}) {
    this.#write = write;
    this.#onError = onError;
  }

  add(topicId: Id) {
    this.#pending.set(topicId, (this.#pending.get(topicId) ?? 0) + 1);
  }

  /** Views counted here but not yet written. */
  pending(topicId: Id): number {
    return this.#pending.get(topicId) ?? 0;
  }

  /** Writes everything counted so far. Failed writes are kept for the next flush. */
  flush(): Promise<void> {
    this.#flushing ??= (async () => {
      const batch = this.#pending;
      this.#pending = new Map();
      for (const [id, by] of batch) {
        try {
          await this.#write(id, by);
        } catch (e) {
          this.#pending.set(id, (this.#pending.get(id) ?? 0) + by);
          this.#onError(e);
        }
      }
    })().finally(() => {
      this.#flushing = undefined;
    });
    return this.#flushing;
  }

  start(intervalMs = VIEW_FLUSH_MS): () => void {
    const timer = setInterval(() => void this.flush(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
