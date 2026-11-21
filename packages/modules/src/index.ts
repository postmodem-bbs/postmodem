// SPDX-License-Identifier: AGPL-3.0-or-later
// The first-party packages installed with every image (PACKAGES.md §2.11, tier A first).
import type { PackageDefinition } from "@postmodem/core";
import { editPolicy } from "./edit-policy.ts";
import { loginSecurity } from "./login-security.ts";
import { quickReply } from "./quick-reply.ts";
import { reports } from "./reports.ts";
import { revisions } from "./revisions.ts";
import { trashBin } from "./trash-bin.ts";
import { unreadTracking } from "./unread-tracking.ts";

export { editPolicy, editPolicyVote, editWindowMinutes, protectAdminPosts } from "./edit-policy.ts";
export {
  REPORT_REASON_MAX,
  REPORTS_CHANNEL,
  type Report,
  type ReportsStore,
  reportsFor,
  reportsStore,
} from "./reports.ts";
export {
  maySeeRevisions,
  type Revision,
  type RevisionsStore,
  revisionsAuthorsSee,
  revisionsKeepDays,
  revisionsStore,
} from "./revisions.ts";
export { restoreTrashedTopic, TRASHED, trashDestination } from "./trash-bin.ts";
export { type UnreadStore, unreadDays, unreadStore } from "./unread-tracking.ts";

export const INSTALLED_PACKAGES: PackageDefinition[] = [
  quickReply,
  reports,
  unreadTracking,
  revisions,
  editPolicy,
  loginSecurity,
  trashBin,
];

export { loginSecuritySettings } from "./login-security.ts";
