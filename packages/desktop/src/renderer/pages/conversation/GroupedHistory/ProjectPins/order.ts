import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '../types';

/** Read persisted workspace identities without retaining duplicates or invalid entries. */
export const normalizeProjectPins = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter((workspace): workspace is string => typeof workspace === 'string' && !!workspace.trim())
        ),
      ]
    : [];

/** Keep unpinned groups in their existing order, after groups pinned earliest. */
export const orderProjectGroups = <T extends { workspace?: string }>(
  groups: readonly T[],
  pinnedWorkspaces: readonly string[]
): T[] => {
  const positions = new Map(normalizeProjectPins(pinnedWorkspaces).map((workspace, index) => [workspace, index]));
  const rank = (group: T): number =>
    group.workspace ? (positions.get(group.workspace) ?? positions.size) : positions.size;
  return groups.toSorted((a, b) => rank(a) - rank(b));
};

/** Collect project groups in the same order used by the sidebar and keyboard navigation. */
export const collectProjectGroups = (sections: TimelineSection[], pinnedWorkspaces: readonly string[]) => {
  const seen = new Set<string>();
  const groups: Array<{ workspace: string; displayName: string; conversations: TChatConversation[] }> = [];
  for (const section of sections) {
    for (const item of section.items) {
      const group = item.workspaceGroup;
      if (item.type !== 'workspace' || !group || seen.has(group.workspace)) continue;
      seen.add(group.workspace);
      groups.push({ workspace: group.workspace, displayName: group.display_name, conversations: group.conversations });
    }
  }
  return orderProjectGroups(groups, pinnedWorkspaces);
};
