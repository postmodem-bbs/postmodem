// SPDX-License-Identifier: AGPL-3.0-or-later
// Rank images from <dataDir>/uploads/ranks (#130): imported from the old board's directory,
// or uploaded in Admin → Ranks.
import { error } from "@sveltejs/kit";
import { serveUpload, uploadsDir } from "#lib/server/uploads.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) =>
  (await serveUpload(uploadsDir(locals.ctx.config.dataDir), `ranks/${params.path}`)) ??
  error(404, "Not found");
