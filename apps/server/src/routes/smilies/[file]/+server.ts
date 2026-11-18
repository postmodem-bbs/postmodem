// SPDX-License-Identifier: AGPL-3.0-or-later
// Smiley images. The bundled ones (static/smilies) are served before this route runs; an
// imported board's own smilies were copied to <dataDir>/uploads/smilies by the importer.
import { error } from "@sveltejs/kit";
import { serveUpload, uploadsDir } from "#lib/server/uploads.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) =>
  (await serveUpload(uploadsDir(locals.ctx.config.dataDir), `smilies/${params.file}`)) ??
  error(404, "Not found");
