// SPDX-License-Identifier: AGPL-3.0-or-later
// One document of a package's collection: change (PATCH) or delete (DELETE), as JSON.
import { collectionKey, handle, json, jsonBody, publicDoc, ruleContext } from "#lib/server/collections.ts";
import type { RequestHandler } from "./$types";

export const PATCH: RequestHandler = async ({ locals, params, url, request }) => {
  const key = collectionKey(locals, params);
  const input = await jsonBody(request);
  const doc = await handle(() =>
    locals.ctx.platform.collections.update(key, ruleContext(locals, url), params.id, input),
  );
  return json(publicDoc(doc));
};

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  const key = collectionKey(locals, params);
  await handle(() => locals.ctx.platform.collections.remove(key, ruleContext(locals, url), params.id));
  return new Response(null, { status: 204 });
};
