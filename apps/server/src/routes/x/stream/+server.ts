// SPDX-License-Identifier: AGPL-3.0-or-later
// /x/stream — one server-sent event stream per open page (PLATFORM-SERVICES §7). The page
// names what it follows: ?sub=core.topic:12&sub=core.user:5. Each subscription is checked
// against its channel's rule when the stream opens; ones the reader may not follow are
// dropped silently. A reconnecting browser sends Last-Event-ID and gets what it missed.
import type { Subscription } from "@postmodem/core";
import type { RequestHandler } from "./$types";

/** A comment line every so often keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;
/** Browsers wait this long before reconnecting after the stream drops. */
const RETRY_MS = 5_000;

function parseSubs(url: URL): Subscription[] {
  return url.searchParams.getAll("sub").flatMap((s) => {
    const m = /^([a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9]*)(?::(\d{1,15}))?$/.exec(s);
    return m ? [{ channel: m[1]!, scope: m[2] ? Number(m[2]) : null }] : [];
  });
}

export const GET: RequestHandler = async ({ locals, url, request }) => {
  const { channels, streams } = locals.ctx.platform;
  const subs = await channels.authorize(locals.perms, parseSubs(url));
  const lastId = request.headers.get("last-event-id") ?? url.searchParams.get("last") ?? undefined;
  const encoder = new TextEncoder();
  let end = () => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      write(`retry: ${RETRY_MS}\n: ${subs.length} subscription(s)\n\n`);
      const unsubscribe = channels.open(
        subs,
        (m) =>
          write(
            `id: ${m.id}\nevent: message\ndata: ${JSON.stringify({ channel: m.channel, scope: m.scope, event: m.event, data: m.data })}\n\n`,
          ),
        lastId && /^\d{14}-\d{6}$/.test(lastId) ? lastId : undefined,
      );
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      end = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(end);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      streams.add(end);
      request.signal.addEventListener("abort", end);
    },
    cancel() {
      end();
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      // Caddy and nginx must pass events through as they come, not buffer them.
      "x-accel-buffering": "no",
    },
  });
};
