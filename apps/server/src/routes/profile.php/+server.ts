// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2's profile.php?mode=… entry points. Registration moved to /register; profiles
// (mode=viewprofile) arrive with M1's profile page.
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  if (url.searchParams.get("mode") === "register") redirect(301, "/register");
  error(404, "Not found");
};
