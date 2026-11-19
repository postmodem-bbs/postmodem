// SPDX-License-Identifier: AGPL-3.0-or-later
// A package's collection: list (GET) and add (POST), as JSON (PLATFORM-SERVICES §6.4).
import { collectionKey, handle, json, jsonBody, publicDoc, ruleContext } from "#lib/server/collections.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const key = collectionKey(locals, params);
  const limit = Number(url.searchParams.get("limit") ?? 30) || 30;
  const before = url.searchParams.get("before") ?? undefined;
  const docs = await handle(() =>
    locals.ctx.platform.collections.list(key, ruleContext(locals, url), {
      limit,
      ...(before ? { before } : {}),
    }),
  );
  return json({ items: docs.map(publicDoc) }, { headers: { "cache-control": "private, no-store" } });
};

export const POST: RequestHandler = async ({ locals, params, url, request }) => {
  const key = collectionKey(locals, params);
  const input = await jsonBody(request);
  const doc = await handle(() =>
    locals.ctx.platform.collections.create(key, ruleContext(locals, url), input),
  );
  return json(publicDoc(doc), { status: 201 });
};
