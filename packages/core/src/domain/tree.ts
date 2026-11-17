// SPDX-License-Identifier: AGPL-3.0-or-later
// Materialised-path helpers for the node tree. Paths look like "/1/7/12/".
import type { Id } from "./types.ts";

export const rootPath = (id: Id): string => `/${id}/`;
export const childPath = (parentPath: string, id: Id): string => `${parentPath}${id}/`;
export const depthOf = (path: string): number => path.split("/").filter(Boolean).length - 1;
export const idsOf = (path: string): Id[] => path.split("/").filter(Boolean).map(Number);
export const isWithin = (path: string, ancestorPath: string): boolean => path.startsWith(ancestorPath);

export class TreeError extends Error {}

/**
 * Validate moving the node at `nodePath` under `newParentPath` (null = to the top level).
 * Returns the node's new path. Moving a node into its own subtree would create a cycle.
 */
export function planMove(nodeId: Id, nodePath: string, newParentPath: string | null): string {
  if (newParentPath !== null && isWithin(newParentPath, nodePath)) {
    throw new TreeError(`node ${nodeId} can't be moved into its own subtree`);
  }
  return newParentPath === null ? rootPath(nodeId) : childPath(newParentPath, nodeId);
}
