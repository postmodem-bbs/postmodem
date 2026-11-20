// SPDX-License-Identifier: AGPL-3.0-or-later
import { requireAdmin } from "#lib/server/admin.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ locals, url, getClientAddress }) => {
  requireAdmin(locals, url, "admin.config");
  return new Response(`${getClientAddress()}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};
