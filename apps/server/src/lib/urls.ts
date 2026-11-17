// SPDX-License-Identifier: AGPL-3.0-or-later
// Link building. Only the default "classic" style of ADR 0012 for now (byte-for-byte phpBB2);
// the full urls service with numbered/slug styles and redirects arrives in M1 slice 7.
// Every link in the UI must go through here.
type Id = number;

const withStart = (base: string, start?: number) => (start ? `${base}&start=${start}` : base);

export const urls = {
  index: () => "/",
  category: (id: Id) => `/#c${id}`,
  forum: (id: Id, start?: number) => withStart(`/viewforum.php?f=${id}`, start),
  topic: (id: Id, start?: number) => withStart(`/viewtopic.php?t=${id}`, start),
  post: (id: Id) => `/viewtopic.php?p=${id}#p${id}`,
};
