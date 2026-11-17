// SPDX-License-Identifier: AGPL-3.0-or-later
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { PgBackend } from "./pg.ts";

export function postgresJsBackend(url: string, password?: string): PgBackend {
  const sql = postgres(url, { ...(password ? { password } : {}), max: 10, onnotice: () => {} });
  return {
    orm: drizzle(sql),
    async withSession(fn) {
      const conn = await sql.reserve();
      try {
        return await fn({
          exec: async (text) => void (await conn.unsafe(text)),
          query: async <T>(text: string, params: unknown[] = []) =>
            (await conn.unsafe(text, params as never[])) as T[],
        });
      } finally {
        conn.release();
      }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
