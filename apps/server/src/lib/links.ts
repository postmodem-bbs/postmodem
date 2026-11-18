// SPDX-License-Identifier: AGPL-3.0-or-later
// The urls service for components, in the board's current style (from the layout data).
import type { UrlStyle } from "@postmodem/core";
import { page } from "$app/state";
import { makeUrls, type Urls } from "./urls.ts";

const cache = new Map<UrlStyle, Urls>();

/** Call inside `$derived` so links follow a style change on the next navigation. */
export function links(): Urls {
  const style = ((page.data as { urlStyle?: UrlStyle }).urlStyle ?? "classic") as UrlStyle;
  const cached = cache.get(style);
  if (cached) return cached;
  const urls = makeUrls(style);
  cache.set(style, urls);
  return urls;
}
