import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';
import {
  collectProjectGroups,
  normalizeProjectPins,
  orderProjectGroups,
} from '@/renderer/pages/conversation/GroupedHistory/ProjectPins/order';
import { buildVisibleConversationIds } from '@/renderer/pages/conversation/GroupedHistory/utils/visibleConversationOrder';

const conversation = (id: string, workspace?: string): TChatConversation =>
  ({
    id,
    name: id,
    type: 'acp',
    created_at: 1,
    modified_at: 1,
    extra: { workspace, custom_workspace: !!workspace },
  }) as TChatConversation;
const sections: TimelineSection[] = [
  {
    timeline: 'Today',
    items: [
      { type: 'conversation', time: 30, conversation: conversation('free') },
      {
        type: 'workspace',
        time: 20,
        workspaceGroup: { workspace: '/new', display_name: 'new', conversations: [conversation('new', '/new')] },
      },
      {
        type: 'workspace',
        time: 10,
        workspaceGroup: { workspace: '/old', display_name: 'old', conversations: [conversation('old', '/old')] },
      },
    ],
  },
];

describe('project pin ordering', () => {
  it('puts the earliest pinned group first and preserves recency for other groups', () => {
    const groups = [{ workspace: '/new' }, { workspace: '/second' }, { workspace: '/old' }, { workspace: '/other' }];
    expect(orderProjectGroups(groups, ['/old', '/second'])).toEqual([groups[2], groups[1], groups[0], groups[3]]);
    expect(groups.map((group) => group.workspace)).toEqual(['/new', '/second', '/old', '/other']);
  });

  it('ignores stale pins without introducing empty groups', () => {
    expect(collectProjectGroups(sections, ['/missing', '/old']).map((group) => group.workspace)).toEqual([
      '/old',
      '/new',
    ]);
    expect(collectProjectGroups([], ['/old'])).toEqual([]);
  });

  it('retains the first position of duplicates and ignores malformed stored values', () => {
    expect(normalizeProjectPins(['/a', null, '', 7, '/b', '/a', ' '])).toEqual(['/a', '/b']);
    expect(normalizeProjectPins({ workspace: '/a' })).toEqual([]);
    expect(normalizeProjectPins(undefined)).toEqual([]);
  });

  it('matches keyboard navigation to project pins above free conversations', () => {
    expect(
      buildVisibleConversationIds({
        timelineSections: sections,
        pinnedConversations: [],
        expandedWorkspaces: ['/new', '/old'],
        historyView: 'all',
        siderCollapsed: false,
        pinnedWorkspaces: ['/old'],
      })
    ).toEqual(['old', 'new', 'free']);
  });

  it('keeps collapsed groups out of keyboard navigation', () => {
    expect(
      buildVisibleConversationIds({
        timelineSections: sections,
        pinnedConversations: [],
        expandedWorkspaces: ['/new'],
        historyView: 'all',
        siderCollapsed: false,
        pinnedWorkspaces: ['/old'],
      })
    ).toEqual(['new', 'free']);
  });

  it('uses the same project order in bookmarks while preserving order within each group', () => {
    expect(
      buildVisibleConversationIds({
        timelineSections: [],
        pinnedConversations: [conversation('a1', '/a'), conversation('b1', '/b'), conversation('a2', '/a')],
        expandedWorkspaces: [],
        historyView: 'bookmarks',
        siderCollapsed: false,
        pinnedWorkspaces: ['/b'],
      })
    ).toEqual(['b1', 'a1', 'a2']);
  });
});
