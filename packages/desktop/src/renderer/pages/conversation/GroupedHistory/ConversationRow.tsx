/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { CronJobIndicator } from '@/renderer/pages/cron';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { Checkbox, Tooltip } from '@arco-design/web-react';
import { MessageOne, Pushpin, Robot } from '@icon-park/react';
import ForkBranchIcon from '@renderer/components/base/ForkBranchIcon';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import ConversationRowMenu from './components/ConversationRowMenu';
import type { ConversationRowProps } from './types';
import { isConversationPinned } from './utils/groupingHelpers';
import ConversationBookmarkButton from './components/ConversationBookmarkButton';
import ConversationLeadingStatus from './components/ConversationLeadingStatus';
import MindNProgressTitle from './components/MindNProgressTitle';
import {
  ConversationChoiceBadge,
  notificationHighlightStyles,
  useConversationHighlight,
  useUserChoiceNotifications,
} from '@renderer/hooks/context/UserChoiceNotifications';

const getConversationTitlePopupContainer = (_node: HTMLElement): HTMLElement => document.body;
const MNP_TITLE_TOOLTIP_STYLE: React.CSSProperties = { width: 'max-content', maxWidth: 'none' };
const TITLE_OVERFLOW_TOLERANCE_PX = 1;

const renderConversationTitleTooltip = (title: string): React.ReactNode => {
  const separatorIndex = title.indexOf(':');
  if (separatorIndex < 0) return title;

  const documentTitle = title.slice(0, separatorIndex).trim();
  const cardTitle = title.slice(separatorIndex + 1).trim();
  return (
    <div className='flex flex-col'>
      <div className='whitespace-nowrap'>{documentTitle}</div>
      <div className='whitespace-nowrap'>{cardTitle}</div>
    </div>
  );
};

const ConversationRow: React.FC<ConversationRowProps> = (props) => {
  const {
    conversation,
    isGenerating,
    isWaitingConfirmation,
    hasUnread,
    hasFailureUnread = false,
    failureMessage,
    collapsed,
    tooltipEnabled,
    batchMode,
    checked,
    selected,
    menuVisible,
    dimIcon = false,
    dragHandle,
  } = props;
  const logos = useAgentLogos();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { notices } = useUserChoiceNotifications();
  const highlightTone = useConversationHighlight(conversation.id);
  const hasChoiceNotice = notices.some((notice) => notice.conversationId === conversation.id);
  const {
    onToggleChecked,
    onConversationClick,
    onOpenMenu,
    onMenuVisibleChange,
    onEditStart,
    onCreateCronTask,
    onArchive,
    onPermanentDelete,
    onExport,
    onCopy,
    onCopyAll,
    onTogglePin,
    onToggleManualUnread,
    isManualUnread,
    getJobStatus,
  } = props;
  const { t } = useTranslation();
  const titleRef = React.useRef<HTMLSpanElement>(null);
  const [isTitleTooltipVisible, setIsTitleTooltipVisible] = React.useState(false);
  const { info: assistantInfo } = usePresetAssistantInfo(conversation);
  const isPinned = isConversationPinned(conversation);
  // Fork-lineage badge: present only on forked conversations (extra.fork is
  // server-minted by the fork API). Parent name resolves from the loaded
  // sidebar list; a deleted/unloaded parent degrades to the generic tip.
  const forkLineage = (conversation.extra as { fork?: { parent_conversation_id?: string } } | undefined)?.fork;
  const forkParentName = forkLineage?.parent_conversation_id
    ? props.resolveConversationName?.(forkLineage.parent_conversation_id)
    : undefined;
  const cronStatus = getJobStatus(conversation.id);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const titleTooltipProps = collapsed
    ? siderTooltipProps
    : {
        className: 'conversation-title-tooltip-popup',
        trigger: [] as [],
        disabled: isMobile,
        unmountOnExit: true,
        popupHoverStay: false,
        popupVisible: isTitleTooltipVisible,
        getPopupContainer: getConversationTitlePopupContainer,
      };
  const conversationTitle = conversation.name || t('conversation.welcome.newConversation');
  const hasMnPTitleSeparator = conversationTitle.includes(':');

  const renderLeadingIcon = () => {
    if (cronStatus !== 'none') {
      return <CronJobIndicator status={cronStatus} size={16} className='flex-shrink-0' />;
    }

    // When the row is pinned, hovering reveals an overlay on the leading icon —
    // the drag handle when the row is sortable, otherwise a pushpin marker.
    // We dim the resting icon on hover so the overlay reads cleanly.
    const pinnedHoverFade =
      isPinned && !batchMode && !isMobile && !isGenerating && !isWaitingConfirmation && !hasFailureUnread
        ? 'group-hover:opacity-0 transition-opacity'
        : '';
    const composedClass = classNames(pinnedHoverFade);

    const leadingMark = resolveConversationLeadingMark(conversation, assistantInfo, logos);
    if (leadingMark.kind === 'emoji') {
      return (
        <span className={classNames('text-16px leading-none flex-shrink-0', composedClass)}>{leadingMark.value}</span>
      );
    }
    if (leadingMark.kind === 'image') {
      return (
        <ThemedLogo
          src={leadingMark.value}
          alt={leadingMark.label}
          className={classNames('w-16px h-16px rounded-50% flex-shrink-0', composedClass)}
        />
      );
    }
    if (leadingMark.kind === 'assistant_fallback') {
      return (
        <Robot
          theme='outline'
          size='16'
          className={classNames('line-height-0 flex-shrink-0 text-t-secondary', composedClass)}
        />
      );
    }

    return (
      <MessageOne
        theme='outline'
        size='16'
        className={classNames('line-height-0 flex-shrink-0 text-t-secondary', composedClass)}
      />
    );
  };

  const handleRowClick = () => {
    setIsTitleTooltipVisible(false);
    cleanupSiderTooltips();
    if (batchMode) {
      onToggleChecked(conversation);
      return;
    }
    onConversationClick(conversation);
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsTitleTooltipVisible(false);
    cleanupSiderTooltips();
    if (batchMode) {
      return;
    }
    onOpenMenu(conversation);
  };

  const handleRowMouseEnter = () => {
    if (collapsed || isMobile || !conversation.name) return;
    const titleElement = titleRef.current;
    setIsTitleTooltipVisible(
      Boolean(titleElement && titleElement.scrollWidth > titleElement.clientWidth + TITLE_OVERFLOW_TOLERANCE_PX)
    );
  };

  const handleRowMouseLeave = () => {
    if (!collapsed) setIsTitleTooltipVisible(false);
  };

  const renderCompletionUnreadDot = () => {
    if (batchMode || !hasUnread || hasFailureUnread) {
      return null;
    }

    return (
      <span className='absolute end-8px top-1/2 -translate-y-1/2 flex items-center justify-center group-hover:hidden'>
        <span
          data-testid={`conversation-completion-unread-${conversation.id}`}
          className='h-8px w-8px rounded-full bg-[var(--conversation-completion-unread)] shadow-[0_0_0_2px_var(--conversation-completion-unread-ring)]'
        />
      </span>
    );
  };

  return (
    <Tooltip
      key={conversation.id}
      {...titleTooltipProps}
      content={renderConversationTitleTooltip(conversationTitle)}
      position='right'
      style={hasMnPTitleSeparator ? MNP_TITLE_TOOLTIP_STYLE : undefined}
    >
      <div
        id={'c-' + conversation.id}
        data-notification-highlight={highlightTone === 'notification' || undefined}
        data-source-highlight={highlightTone === 'source' || undefined}
        className={classNames(
          'chat-history__item h-34px rd-8px flex items-center group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px min-w-0 transition-colors',
          collapsed ? 'justify-center px-0' : `justify-start gap-8px ${hasChoiceNotice ? 'pe-56px' : 'pe-16px'}`,
          // dimIcon means this row sits inside a project/cron parent — visually indent the row content while keeping the bg full-width
          !collapsed && (dimIcon ? 'ps-34px' : 'ps-10px'),
          highlightTone && notificationHighlightStyles.conversation,
          highlightTone === 'source' && notificationHighlightStyles.sourceConversation,
          {
            'hover:bg-fill-3': !batchMode && !selected,
            '!bg-fill-3': selected,
            'bg-[rgba(var(--primary-6),0.08)]': batchMode && checked,
          }
        )}
        onClick={handleRowClick}
        onContextMenu={handleRowContextMenu}
        onMouseEnter={handleRowMouseEnter}
        onMouseLeave={handleRowMouseLeave}
      >
        {batchMode && (
          <span
            className='me-8px flex-center'
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked(conversation);
            }}
          >
            <Checkbox checked={checked} />
          </span>
        )}
        {!batchMode && !collapsed && (
          <ConversationBookmarkButton
            conversation={conversation}
            isPinned={isPinned}
            isMobile={isMobile}
            onTogglePin={onTogglePin}
            statusLayout={dimIcon ? 'gutter' : 'compact'}
          />
        )}
        <span
          data-testid={`conversation-leading-icon-${conversation.id}`}
          className='size-22px flex items-center justify-center shrink-0 relative'
        >
          <ConversationLeadingStatus
            conversationId={conversation.id}
            isGenerating={isGenerating}
            isWaitingConfirmation={isWaitingConfirmation}
            hasFailure={hasFailureUnread}
            failureMessage={failureMessage}
            batchMode={batchMode}
            useLeadingGutter={!collapsed && dimIcon}
          >
            {renderLeadingIcon()}
          </ConversationLeadingStatus>
          {/* Hover overlay on the leading icon: drag handle for sortable pinned rows, pushpin marker otherwise */}
          {!batchMode &&
            isPinned &&
            !isMobile &&
            !isGenerating &&
            !isWaitingConfirmation &&
            !hasFailureUnread &&
            (dragHandle ?? (
              <span
                className='absolute inset-0 flex-center text-t-secondary pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity'
                style={{ lineHeight: 0 }}
              >
                <Pushpin theme='outline' size='14' />
              </span>
            ))}
        </span>
        <FlexFullContainer className='h-24px min-w-0 flex-1 collapsed-hidden'>
          <div className='chat-history__item-name overflow-hidden text-ellipsis flex items-center gap-4px w-full text-14px font-[500] lh-24px whitespace-nowrap min-w-0 text-t-primary'>
            <span
              ref={titleRef}
              className='conversation-title-text block overflow-hidden text-ellipsis whitespace-nowrap min-w-0'
            >
              <MindNProgressTitle>{conversation.name}</MindNProgressTitle>
            </span>
            {forkLineage && (
              <Tooltip
                content={
                  forkParentName
                    ? t('conversation.history.forkedFrom', { name: forkParentName })
                    : t('conversation.history.forkedConversation')
                }
                position='top'
              >
                <span className='flex-shrink-0 line-height-0 text-t-tertiary' data-testid='conversation-fork-badge'>
                  <ForkBranchIcon size={12} />
                </span>
              </Tooltip>
            )}
          </div>
        </FlexFullContainer>

        {hasChoiceNotice && (
          <span className={collapsed ? 'absolute end-0 top-0' : 'absolute end-32px top-1/2 -translate-y-1/2'}>
            <ConversationChoiceBadge conversationId={conversation.id} />
          </span>
        )}
        {renderCompletionUnreadDot()}
        {!batchMode && (
          <div
            className={classNames(
              'absolute end-8px top-1/2 -translate-y-1/2 items-center justify-end !collapsed-hidden',
              {
                flex: isMobile || menuVisible,
                'hidden group-hover:flex': !isMobile && !menuVisible,
              }
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <ConversationRowMenu
              conversation={conversation}
              isMobile={isMobile}
              isPinned={isPinned}
              menuVisible={menuVisible}
              onOpenMenu={onOpenMenu}
              onMenuVisibleChange={onMenuVisibleChange}
              onEditStart={onEditStart}
              onCreateCronTask={onCreateCronTask}
              onExport={onExport}
              onCopy={onCopy}
              onCopyAll={onCopyAll}
              onArchive={onArchive}
              onPermanentDelete={onPermanentDelete}
              onTogglePin={onTogglePin}
              onToggleManualUnread={onToggleManualUnread}
              isManualUnread={isManualUnread}
            />
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default ConversationRow;
