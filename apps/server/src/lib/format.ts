// SPDX-License-Identifier: AGPL-3.0-or-later
// Locale-aware dates in the reader's time zone and date format (#129). The server picks both
// per request (root layout: `data.dates`) and the client reuses them, so server and client
// output stay identical. Formatters are costly to build, so each is built once per locale,
// zone and style (a topic page formats dozens of dates).

/** How one reader sees dates. `style` is one of the core's DATE_FORMATS. */
export interface DateFormat {
  locale: string;
  timeZone: string;
  style: "medium" | "long" | "short" | "iso";
}

const cache = new Map<string, Intl.DateTimeFormat>();

function options(style: DateFormat["style"], withTime: boolean): [string | null, Intl.DateTimeFormatOptions] {
  if (style === "iso")
    // Swedish writes dates as ISO 8601 (2026-11-23 14:05), with a 24-hour clock.
    return [
      "sv-SE",
      withTime
        ? {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }
        : { year: "numeric", month: "2-digit", day: "2-digit" },
    ];
  return [null, withTime ? { dateStyle: style, timeStyle: "short" } : { dateStyle: style }];
}

function formatter(f: DateFormat, withTime: boolean): Intl.DateTimeFormat {
  const key = `${f.locale}|${f.timeZone}|${f.style}|${withTime}`;
  let fmt = cache.get(key);
  if (!fmt) {
    const [locale, opts] = options(f.style, withTime);
    fmt = new Intl.DateTimeFormat(locale ?? f.locale, { ...opts, timeZone: f.timeZone });
    cache.set(key, fmt);
  }
  return fmt;
}

export const formatDateTime = (ms: number, f: DateFormat): string => formatter(f, true).format(ms);
export const formatDate = (ms: number, f: DateFormat): string => formatter(f, false).format(ms);
export const isoDate = (ms: number) => new Date(ms).toISOString();
