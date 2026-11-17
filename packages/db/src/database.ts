// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SettingsStore } from "@postmodem/core";

export interface Database {
  dialect: "sqlite" | "pg";
  ping(): Promise<void>;
  /** Ids of migrations not yet applied (used by /readyz and `postmodem doctor`). */
  pendingMigrations(): Promise<string[]>;
  /** Apply pending migrations; safe to run concurrently from several containers. */
  migrate(): Promise<string[]>;
  settingsStore(): SettingsStore;
  close(): Promise<void>;
}
