// SPDX-License-Identifier: AGPL-3.0-or-later
// Live updates in the browser (M2b slice 10): one EventSource per page for every component's
// subscriptions. Pages work the same without it; this only saves a reload. When the set of
// subscriptions changes the stream is reopened from the last event seen, so nothing is lost.

export interface LiveMessage {
  channel: string;
  scope: number | null;
  event: string;
  data: Record<string, unknown>;
}

const listeners = new Map<string, Set<(m: LiveMessage) => void>>();
let source: EventSource | null = null;
let lastId = "";
let pending: ReturnType<typeof setTimeout> | undefined;

const keyOf = (channel: string, scope: number | null) => (scope === null ? channel : `${channel}:${scope}`);

function reopen() {
  clearTimeout(pending);
  // Components mount one after another; open once for all of them.
  pending = setTimeout(() => {
    source?.close();
    source = null;
    if (!listeners.size || typeof EventSource === "undefined") return;
    const params = new URLSearchParams();
    for (const key of listeners.keys()) params.append("sub", key);
    if (lastId) params.set("last", lastId);
    source = new EventSource(`/x/stream?${params}`);
    source.onmessage = (e) => {
      if (e.lastEventId) lastId = e.lastEventId;
      let m: LiveMessage;
      try {
        m = JSON.parse(e.data) as LiveMessage;
      } catch {
        return;
      }
      for (const fn of listeners.get(keyOf(m.channel, m.scope)) ?? []) fn(m);
    };
  }, 50);
}

/** Follows a channel (at a scope) until the returned function is called. */
export function follow(channel: string, scope: number | null, fn: (m: LiveMessage) => void): () => void {
  const key = keyOf(channel, scope);
  let set = listeners.get(key);
  const added = !set;
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  if (added) reopen();
  return () => {
    set.delete(fn);
    if (!set.size) {
      listeners.delete(key);
      reopen();
    }
  };
}
