/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getParentAndCurrentDir } from '@/renderer/utils/workspace/projectPathLabel';
import { Spin } from '@arco-design/web-react';
import React from 'react';
import { Attention } from '@icon-park/react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import type { ProjectGroupIndicatorStatus } from '../utils/completionUnread';
import { ProjectChoiceBadge } from '@renderer/hooks/context/UserChoiceNotifications';

const ProjectFailureMarker: React.FC = () => {
  const { t } = useTranslation();
  return (
    <span
      role='img'
      aria-label={t('conversation.history.responseFailed')}
      className='absolute right-8px size-16px flex-center shrink-0 group-hover:hidden'
    >
      <Attention theme='filled' size='16' className='line-height-0 text-danger' data-testid='project-failure-unread' />
    </span>
  );
};

type ProjectGroupHeaderProps = {
  workspace: string;
  displayName: string;
  branch?: string | null;
  indicatorStatus?: ProjectGroupIndicatorStatus;
  choiceConversationIds?: readonly string[];
};

const ProjectGroupHeader: React.FC<ProjectGroupHeaderProps> = ({
  workspace,
  displayName,
  branch,
  indicatorStatus = 'none',
  choiceConversationIds = [],
}) => {
  const isGenerating = indicatorStatus === 'generating' || indicatorStatus === 'generating-completion-unread';
  const hasFailure = indicatorStatus === 'failure-unread' || indicatorStatus === 'failure-completion-unread';
  const hasCompletionUnread =
    indicatorStatus === 'completion-unread' ||
    indicatorStatus === 'generating-completion-unread' ||
    indicatorStatus === 'failure-completion-unread';
  const hasPrimaryStatus = isGenerating || hasFailure;

  return (
    <span className='flex items-center flex-1 min-w-0 gap-8px'>
      <span className='flex flex-col flex-1 min-w-0 leading-tight'>
        <span className='text-14px font-[500] truncate text-t-primary'>
          {getParentAndCurrentDir(workspace) || displayName}
        </span>
        {branch && <span className='text-11px font-[400] truncate text-t-secondary'>({branch})</span>}
      </span>
      <ProjectChoiceBadge conversationIds={choiceConversationIds} />
      {isGenerating && (
        <span
          data-testid='project-generating'
          aria-hidden='true'
          className='absolute right-8px size-16px flex items-center justify-center shrink-0 group-hover:hidden'
        >
          <Spin size={16} />
        </span>
      )}
      {hasFailure && <ProjectFailureMarker />}
      {hasCompletionUnread && (
        <span
          data-testid='project-completion-unread'
          aria-hidden='true'
          className={classNames(
            'absolute h-8px w-8px rounded-full bg-[var(--conversation-completion-unread)] shadow-[0_0_0_2px_var(--conversation-completion-unread-ring)] shrink-0 group-hover:hidden',
            hasPrimaryStatus ? 'right-5px bottom-5px' : 'right-8px'
          )}
        />
      )}
    </span>
  );
};

export default ProjectGroupHeader;
