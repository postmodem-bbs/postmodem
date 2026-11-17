// SPDX-License-Identifier: AGPL-3.0-or-later
// Drizzle table definitions, one per dialect. Keep them in lockstep with migrations.ts.
import { jsonb, pgTable, text as pgText, timestamp } from "drizzle-orm/pg-core";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sqliteSettings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pgSettings = pgTable("settings", {
  key: pgText("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
