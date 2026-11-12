/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { useEffect, useRef, useState } from 'react';

/**
 * Parse the current branch name out of a `.git/HEAD` file's contents.
 *
 * - On a branch: `ref: refs/heads/<branch>` → `<branch>`
 * - Detached HEAD: a raw commit SHA → short 7-char hash
 * - Anything else / empty: `null`
 */
export const parseGitHead = (raw: string | null): string | null => {
  if (!raw) return null;
  const text = raw.trim();
  const refMatch = text.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (refMatch) return refMatch[1].trim();
  if (/^[0-9a-f]{7,40}$/i.test(text)) return text.slice(0, 7);
  return null;
};

/** How often to refresh Git branches so external branch switches get reflected. */
const GIT_BRANCH_POLL_MS = 5000;

/**
 * Resolve the Git branch for all project workspaces with one backend request.
 * Returns a map of workspace path → branch name (or `null` when the folder is
 * not a repository).
 */
export const useProjectGitBranches = (workspaces: string[]): Record<string, string | null> => {
  const [branches, setBranches] = useState<Record<string, string | null>>({});
  const lastBranches = useRef(branches);
  // Stable dependency so order changes and duplicate workspaces do not restart polling.
  const workspacesKey = JSON.stringify([...new Set(workspaces.filter(Boolean))].toSorted());

  useEffect(() => {
    let cancelled = false;
    let refreshPromise: Promise<void> | null = null;
    const targetWorkspaces = JSON.parse(workspacesKey) as string[];
    const targetWorkspaceSet = new Set(targetWorkspaces);

    const publish = (next: Record<string, string | null>): void => {
      if (cancelled) return;
      const previous = lastBranches.current;
      const keys = Object.keys(next);
      if (
        Object.keys(previous).length === keys.length &&
        keys.every((workspace) => previous[workspace] === next[workspace])
      ) {
        return;
      }
      lastBranches.current = next;
      setBranches(next);
    };

    const refresh = (): Promise<void> => {
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        const nextBranches: Record<string, string | null> = Object.fromEntries(
          targetWorkspaces.map((workspace): [string, null] => [workspace, null])
        );
        try {
          const response = await ipcBridge.fs.getGitBranches.invoke({ workspaces: targetWorkspaces });
          for (const item of response) {
            if (targetWorkspaceSet.has(item.workspace)) {
              nextBranches[item.workspace] = typeof item.branch === 'string' ? item.branch : null;
            }
          }
        } catch {
          // A batch-level failure keeps every requested workspace explicitly unknown.
        }
        publish(nextBranches);
      })().finally(() => {
        refreshPromise = null;
      });
      return refreshPromise;
    };

    if (targetWorkspaces.length === 0) {
      publish({});
      return;
    }

    void refresh();
    // Poll so branch switches made outside the app (e.g. in a terminal) get reflected.
    const intervalId = setInterval(() => void refresh(), GIT_BRANCH_POLL_MS);
    // Refresh immediately when the window regains focus for fast feedback.
    const onFocus = (): void => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [workspacesKey]);

  return branches;
};
