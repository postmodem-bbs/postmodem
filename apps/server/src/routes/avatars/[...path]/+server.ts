// SPDX-License-Identifier: AGPL-3.0-or-later
// Avatars from <dataDir>/uploads/avatars: imported uploads (upload/…) and gallery images
// (gallery/…). Uploading new ones comes with the editor and profile settings (M2).
import { error } from "@sveltejs/kit";
import { serveUpload, uploadsDir } from "#lib/server/uploads.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, locals }) =>
  (await serveUpload(uploadsDir(locals.ctx.config.dataDir), `avatars/${params.path}`)) ??
  error(404, "Not found");
