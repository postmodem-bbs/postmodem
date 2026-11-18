// SPDX-License-Identifier: AGPL-3.0-or-later
// Universal hooks (server and browser). `reroute` maps every public URL shape of every style
// (ADR 0012) onto the internal id-based routes; the pages then redirect to the canonical URL.
import type { Reroute } from "@sveltejs/kit/hooks";
import { internalPath } from "#lib/urls.ts";

export const reroute: Reroute = ({ url }) => internalPath(url);
