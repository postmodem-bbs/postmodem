// SPDX-License-Identifier: AGPL-3.0-or-later
// The first-party packages installed with every image (PACKAGES.md §2.11, tier A first).
import type { PackageDefinition } from "@postmodem/core";
import { quickReply } from "./quick-reply.ts";
import { reports } from "./reports.ts";
import { unreadTracking } from "./unread-tracking.ts";

export {
  REPORT_REASON_MAX,
  REPORTS_CHANNEL,
  type Report,
  type ReportsStore,
  reportsFor,
  reportsStore,
} from "./reports.ts";
export { type UnreadStore, unreadDays, unreadStore } from "./unread-tracking.ts";

export const INSTALLED_PACKAGES: PackageDefinition[] = [quickReply, reports, unreadTracking];
