// SPDX-License-Identifier: AGPL-3.0-or-later
// /verify?token=… confirms an e-mail address. Opening the link only shows a button; the
// POST does the work, so mail scanners that prefetch links can't use the token up.
import { checkEmailToken, startSession, verifyEmail } from "@postmodem/core";
import { fail, redirect } from "@sveltejs/kit";
import { setSessionCookie } from "#lib/server/auth.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, locals }) => {
  const token = url.searchParams.get("token") ?? "";
  if (!token) return { sent: url.searchParams.has("sent"), token: null, name: null, invalid: false };
  const user = await checkEmailToken(locals.ctx.db.repos, token, "verify-email");
  return { sent: false, token: user ? token : null, name: user?.username ?? null, invalid: !user };
};

export const actions: Actions = {
  default: async ({ request, cookies, locals, getClientAddress }) => {
    const { ctx } = locals;
    const token = String((await request.formData()).get("token") ?? "");
    const user = await verifyEmail(ctx.db.repos, token);
    if (!user) return fail(400, { invalid: true });
    const { token: session } = await startSession(ctx.db.repos, user.id, {
      userAgent: request.headers.get("user-agent") ?? "",
      ip: getClientAddress(),
    });
    setSessionCookie(cookies, ctx.config, session);
    ctx.log.info("e-mail verified", { userId: user.id });
    redirect(303, "/?notice=verified");
  },
};
