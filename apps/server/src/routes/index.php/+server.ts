// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2's index.php (and index.php?c=ID) keeps working for imported boards.
import { redirect } from "@sveltejs/kit";
import { urls } from "#lib/urls.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const c = Number(url.searchParams.get("c"));
  redirect(301, Number.isInteger(c) && c > 0 ? urls.category(c) : urls.index());
};
