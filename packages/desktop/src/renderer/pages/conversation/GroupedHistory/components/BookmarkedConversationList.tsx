/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import WorkspaceCollapse from '@/renderer/pages/conversation/components/WorkspaceCollapse';
import { restrictToVerticalAxis } from '@/renderer/utils/ui/dndModifiers';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Empty } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ConversationRow from '../ConversationRow';
import SortableConversationRow from '../SortableConversationRow';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import type { ConversationRowProps } from '../types';
import { groupBookmarkedConversations } from '../utils/bookmarkHelpers';
import { resolveProjectGroupIndicatorStatus } from '../utils/completionUnread';
import ProjectGroupHeader from './ProjectGroupHeader';

type BookmarkedConversationListProps = {
  conversations: TChatConversation[];
  collapsed: boolean;
  batchMode: boolean;
  expandedWorkspaces: string[];
  onToggleWorkspace: (workspace: string) => void;
  collapsedSections: ReadonlySet<string>;
  onToggleSection: (section: string) => void;
  projectGitBranches: Record<string, string | null>;
  hasCompletionUnread: (conversationId: string) => boolean;
  isConversationGenerating: (conversationId: string) => boolean;
  getConversationRowProps: (conversation: TChatConversation) => ConversationRowProps;
};

const BookmarkedConversationList: React.FC<BookmarkedConversationListProps> = ({
  conversations,
  collapsed,
  batchMode,
  expandedWorkspaces,
  onToggleWorkspace,
  collapsedSections,
  onToggleSection,
  projectGitBranches,
  hasCompletionUnread,
  isConversationGenerating,
  getConversationRowProps,
}) => {
  const { t } = useTranslation();
  const groups = useMemo(() => groupBookmarkedConversations(conversations, t), [conversations, t]);
  const { sensors, handleDragEnd, isDragEnabled } = useDragAndDrop({
    pinnedConversations: conversations,
    batchMode,
    collapsed,
  });

  if (groups.length === 0) {
    return (
      <div className='py-48px flex-center'>
        <Empty description={t('conversation.history.bookmarksEmpty')} />
      </div>
    );
  }

  return groups.map((group) => {
    const sectionKey = `bookmark:${group.key}`;
    const ids = group.conversations.map((conversation) => conversation.id);
    const conversationList = (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className='min-w-0'>
            {group.conversations.map((conversation) => {
              const props = getConversationRowProps(conversation);
              return isDragEnabled ? (
                <SortableConversationRow key={conversation.id} {...props} dimIcon={Boolean(group.workspace)} />
              ) : (
                <ConversationRow key={conversation.id} {...props} dimIcon={Boolean(group.workspace)} />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    );

    const workspace = group.workspace;
    if (workspace) {
      const isProjectExpanded = expandedWorkspaces.includes(workspace);
      return (
        <WorkspaceCollapse
          key={group.key}
          expanded={isProjectExpanded}
          onToggle={() => onToggleWorkspace(workspace)}
          siderCollapsed={collapsed}
          stickyHeader
          header={
            <ProjectGroupHeader
              workspace={workspace}
              displayName={group.label}
              branch={projectGitBranches[workspace]}
              indicatorStatus={resolveProjectGroupIndicatorStatus(
                isProjectExpanded,
                group.conversations,
                isConversationGenerating,
                hasCompletionUnread
              )}
            />
          }
        >
          <div className={classNames('flex flex-col min-w-0', { 'mt-1px': !collapsed })}>{conversationList}</div>
        </WorkspaceCollapse>
      );
    }

    const sectionCollapsed = collapsedSections.has(sectionKey);
    return (
      <div key={group.key} className='min-w-0'>
        {!collapsed && (
          <div
            className='group/label sider-section-label flex items-center px-12px h-28px select-none sticky top-0 z-10 mt-8px cursor-pointer'
            onClick={() => onToggleSection(sectionKey)}
          >
            <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
              {group.label}
            </span>
            <span className='ml-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
              <Right
                theme='outline'
                size={12}
                className={classNames('transition-transform duration-150', { 'rotate-90': !sectionCollapsed })}
              />
            </span>
          </div>
        )}
        {!sectionCollapsed && conversationList}
      </div>
    );
  });
};

export default BookmarkedConversationList;
