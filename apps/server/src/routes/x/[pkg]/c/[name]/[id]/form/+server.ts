// SPDX-License-Identifier: AGPL-3.0-or-later
// Changing, deleting, hiding or showing a document from a plain form: `_method` is one of
// update, delete, hide or show; 303 back to `returnTo`.
import { CollectionError } from "@postmodem/core";
import { backTo, collectionKey, formData, ruleContext } from "#lib/server/collections.ts";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ locals, params, url, request }) => {
  const key = collectionKey(locals, params);
  const form = await request.formData();
  const c = ruleContext(locals, url);
  const { collections } = locals.ctx.platform;
  try {
    switch (form.get("_method")) {
      case "update":
        await collections.update(key, c, params.id, formData(form));
        break;
      case "delete":
        await collections.remove(key, c, params.id);
        break;
      case "hide":
      case "show":
        await collections.setHidden(key, c, params.id, form.get("_method") === "hide");
        break;
      default:
        return backTo(form, "invalid");
    }
    return backTo(form, "ok");
  } catch (e) {
    if (e instanceof CollectionError) return backTo(form, e.code);
    throw e;
  }
};
