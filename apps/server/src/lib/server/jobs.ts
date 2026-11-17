// SPDX-License-Identifier: AGPL-3.0-or-later
// Job queue v0 worker (CONTAINERS.md §2): claims jobs from the database, runs their handler,
// retries with exponential backoff. Runs in `postmodem run` (solo) and `postmodem worker`.
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { Logger, Repositories } from "@postmodem/core";

export type JobHandler = (payload: unknown) => Promise<void>;

const LEASE_MS = 2 * 60_000;
const IDLE_POLL_MS = 1_000;
/** 30 s, 2 min, 8 min, 32 min, … capped at 6 h. */
export const retryDelay = (attempt: number) => Math.min(30_000 * 4 ** (attempt - 1), 6 * 3600_000);

export class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
  #running = false;
  #wake: (() => void) | null = null;
  #loop: Promise<void> | null = null;

  readonly repos: Repositories;
  readonly handlers: Record<string, JobHandler>;
  readonly log: Logger;
  constructor(repos: Repositories, handlers: Record<string, JobHandler>, log: Logger) {
    this.repos = repos;
    this.handlers = handlers;
    this.log = log;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#loop = this.#run();
    this.log.info("worker started", { worker: this.id, jobTypes: Object.keys(this.handlers) });
  }

  /** Lets a job enqueued in this process start without waiting for the next poll. */
  nudge(): void {
    this.#wake?.();
  }

  /** Finishes the job in hand, then stops. */
  async stop(): Promise<void> {
    this.#running = false;
    this.nudge();
    await this.#loop;
  }

  /** Runs at most one due job; true if there was one. Exposed for tests and the CLI. */
  async runOnce(now = Date.now()): Promise<boolean> {
    const job = await this.repos.jobs.claim(Object.keys(this.handlers), this.id, now, LEASE_MS);
    if (!job) return false;
    try {
      await this.handlers[job.type]!(job.payload);
      await this.repos.jobs.complete(job.id, Date.now());
      this.log.debug("job done", { job: job.id, type: job.type });
    } catch (e) {
      const error = (e as Error).message || String(e);
      const final = job.attempts >= job.maxAttempts;
      await this.repos.jobs.fail(
        job.id,
        error,
        Date.now(),
        final ? null : Date.now() + retryDelay(job.attempts),
      );
      this.log[final ? "error" : "warn"](final ? "job failed for good" : "job failed, will retry", {
        job: job.id,
        type: job.type,
        attempt: job.attempts,
        error,
      });
    }
    return true;
  }

  async #run(): Promise<void> {
    while (this.#running) {
      let worked = false;
      try {
        worked = await this.runOnce();
      } catch (e) {
        this.log.warn("worker could not reach the queue", { error: (e as Error).message });
      }
      if (!worked && this.#running) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, IDLE_POLL_MS);
          this.#wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.#wake = null;
      }
    }
  }
}
