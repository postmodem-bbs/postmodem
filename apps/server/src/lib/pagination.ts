// SPDX-License-Identifier: AGPL-3.0-or-later
// phpBB2-style pagination: pages are addressed by item offset (`start=`), shown as
// "1 … 4 5 [6] 7 8 … 12".

export const TOPICS_PER_PAGE = 25;
export const POSTS_PER_PAGE = 15;

export interface PageLink {
  number: number;
  start: number;
}
export interface Pagination {
  current: number;
  total: number;
  /** Page links with null where a gap ("…") goes. */
  links: (PageLink | null)[];
  prev: PageLink | null;
  next: PageLink | null;
}

/** Clamp a requested offset to a valid page boundary. */
export function normaliseStart(start: unknown, perPage: number, totalItems: number): number {
  const n = Math.max(0, Math.floor(Number(start) || 0));
  const lastStart = Math.max(0, Math.floor((Math.max(totalItems, 1) - 1) / perPage) * perPage);
  return Math.min(n - (n % perPage), lastStart);
}

export function paginate(totalItems: number, perPage: number, start: number, around = 2): Pagination {
  const total = Math.max(1, Math.ceil(totalItems / perPage));
  const current = Math.floor(start / perPage) + 1;
  const link = (number: number): PageLink => ({ number, start: (number - 1) * perPage });
  const wanted = new Set([1, total]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= total) wanted.add(p);
  const sorted = [...wanted].sort((a, b) => a - b);
  const links: (PageLink | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) links.push(null);
    links.push(link(p));
  });
  return {
    current,
    total,
    links,
    prev: current > 1 ? link(current - 1) : null,
    next: current < total ? link(current + 1) : null,
  };
}
