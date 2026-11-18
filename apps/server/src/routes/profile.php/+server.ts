// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2's profile.php?mode=… entry points. Registration moved to /register; profiles
// (mode=viewprofile) arrive with M1's profile page.
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const mode = url.searchParams.get("mode");
  if (mode === "register") redirect(301, "/register");
  if (mode === "sendpassword") redirect(301, "/reset");
  if (mode === "editprofile") redirect(301, "/account");
  error(404, "Not found");
};
