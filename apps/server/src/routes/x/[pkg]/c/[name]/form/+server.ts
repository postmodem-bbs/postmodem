// SPDX-License-Identifier: AGPL-3.0-or-later
// Adding to a collection from a plain form (no JavaScript): 303 back to `returnTo`.
import { CollectionError } from "@postmodem/core";
import { backTo, collectionKey, formData, ruleContext } from "#lib/server/collections.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ locals, params, url, request }) => {
  const key = collectionKey(locals, params);
  const form = await request.formData();
  try {
    await locals.ctx.platform.collections.create(key, ruleContext(locals, url), formData(form));
    return backTo(form, "ok");
  } catch (e) {
    if (e instanceof CollectionError) return backTo(form, e.code);
    throw e;
  }
};
