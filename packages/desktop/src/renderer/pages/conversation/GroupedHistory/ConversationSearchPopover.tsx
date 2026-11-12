/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import type { IMessageSearchItem } from '@/common/types/team/database';
import AionModal from '@/renderer/components/base/AionModal';
import { AionSearchInput } from '@/renderer/components/base';
import { formatDateTime } from '@/renderer/services/i18n/format';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { ConversationClaudeAccountBadge } from '@/renderer/pages/conversation/platforms/acp/claudeAccounts';
import { blockMobileInputFocus, blurActiveElement } from '@/renderer/utils/ui/focus';
import { isPrimaryApplicationShortcut } from '@/renderer/utils/ui/keyboardShortcuts';
import { getParentAndCurrentDir } from '@/renderer/utils/workspace/projectPathLabel';
import { Button, Checkbox, Empty, Spin, Tooltip, Typography } from '@arco-design/web-react';
import { Close, MessageOne, Robot, Search } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import MindNProgressTitle from './components/MindNProgressTitle';
import { useConversationListPresence } from './hooks/useConversationListSync';
import './ConversationSearchPopover.css';

const PAGE_SIZE = 20;
const MAX_RECENT_SEARCHES = 8;
const RECENT_SEARCH_STORAGE_KEY = 'conversation.historySearch.recentKeywords';
const MATCH_ALL_STORAGE_KEY = 'conversation.historySearch.matchAll';
const SNIPPET_MAX_LENGTH = 110;
const SNIPPET_PREFIX_CONTEXT_LENGTH = 34;
const SNIPPET_SUFFIX_CONTEXT_LENGTH = 58;

type ConversationSearchResult = Omit<IMessageSearchItem, 'message_id' | 'message_type'> & { message_id?: string };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whitespace-separated AND terms without case-insensitive repeats. */
const splitSearchTerms = (keyword: string): string[] => {
  const terms: string[] = [];
  for (const term of keyword.trim().split(/\s+/)) {
    if (term && !terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) terms.push(term);
  }
  return terms;
};

const readStoredMatchAll = (): boolean => {
  try {
    return localStorage.getItem(MATCH_ALL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const buildSnippet = (text: string, terms: string[], maxLength = SNIPPET_MAX_LENGTH): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  // Center the snippet on the earliest term so AND results show a match.
  const lowerText = normalized.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const term of terms) {
    const lowerTerm = term.trim().toLowerCase();
    const index = lowerTerm ? lowerText.indexOf(lowerTerm) : -1;
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index;
      matchLength = lowerTerm.length;
    }
  }
  if (matchIndex === -1) {
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
  }

  let start = Math.max(0, matchIndex - SNIPPET_PREFIX_CONTEXT_LENGTH);
  let end = Math.min(normalized.length, matchIndex + matchLength + SNIPPET_SUFFIX_CONTEXT_LENGTH);

  if (end - start > maxLength) {
    const centeredStart = Math.max(0, matchIndex - Math.floor((maxLength - matchLength) / 2));
    start = Math.min(centeredStart, Math.max(0, normalized.length - maxLength));
    end = Math.min(normalized.length, start + maxLength);
  }

  const snippet = normalized.slice(start, end).trim();
  return `${start > 0 ? '...' : ''}${snippet}${end < normalized.length ? '...' : ''}`;
};

const renderHighlightedText = (text: string, terms: string[]) => {
  const activeTerms = terms.map((term) => term.trim()).filter(Boolean);
  if (activeTerms.length === 0) {
    return text;
  }

  // Try longer terms first so a shorter prefix does not split a longer match.
  const alternatives = activeTerms.toSorted((a, b) => b.length - a.length).map(escapeRegExp);
  const pattern = new RegExp(`(${alternatives.join('|')})`, 'ig');
  const parts = text.split(pattern);
  const lowerTerms = new Set(activeTerms.map((term) => term.toLowerCase()));

  return parts.map((part, index) => {
    if (!lowerTerms.has(part.toLowerCase())) {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }

    return (
      <mark key={`${part}-${index}`} className='conversation-search-modal__highlight'>
        {part}
      </mark>
    );
  });
};

const formatTime = (timestamp: number, locale: string): string => {
  if (!timestamp) return '';
  return formatDateTime(timestamp, locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface ConversationSearchPopoverProps {
  onSessionClick?: () => void;
  onConversationSelect?: () => void;
  disabled?: boolean;
  buttonClassName?: string;
  label?: string;
  fullWidth?: boolean;
  renderTrigger?: (props: { onClick: () => void; isActive: boolean }) => React.ReactNode;
}

const ConversationAgentMark: React.FC<{ conversation: IMessageSearchItem['conversation'] }> = ({ conversation }) => {
  const logos = useAgentLogos();
  const { info: assistantInfo } = usePresetAssistantInfo(conversation);
  const leadingMark = resolveConversationLeadingMark(conversation, assistantInfo, logos);
  if (leadingMark.kind === 'emoji') {
    return (
      <span className='text-18px leading-none flex-shrink-0' title={leadingMark.label}>
        {leadingMark.value}
      </span>
    );
  }
  if (leadingMark.kind === 'image') {
    return (
      <ThemedLogo
        src={leadingMark.value}
        alt={leadingMark.label}
        title={leadingMark.label}
        className='w-18px h-18px rounded-50% flex-shrink-0'
      />
    );
  }
  if (leadingMark.kind === 'assistant_fallback') {
    return <Robot theme='outline' size='18' className='line-height-0 flex-shrink-0 text-t-secondary' />;
  }

  return <MessageOne theme='outline' size='18' className='line-height-0 flex-shrink-0 text-t-secondary' />;
};

const ConversationSearchPopover: React.FC<ConversationSearchPopoverProps> = ({
  onSessionClick,
  onConversationSelect,
  disabled = false,
  buttonClassName,
  label,
  fullWidth = false,
  renderTrigger,
}) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { activeConversationIds, hasCompleteConversationList, refreshConversationListPresence } =
    useConversationListPresence();
  const [visible, setVisible] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [items, setItems] = useState<IMessageSearchItem[]>([]);
  const [idMatch, setIdMatch] = useState<TChatConversation | null>(null);
  const [idLoading, setIdLoading] = useState(false);
  const searchGeneration = useRef(0);
  const nextCursor = useRef<string | undefined>(undefined);
  const searchInFlight = useRef(false);
  const seenMessageIds = useRef(new Set<string>());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [recentKeywords, setRecentKeywords] = useState<string[]>([]);
  const [matchAll, setMatchAll] = useState(readStoredMatchAll);
  const searchTerms = useMemo(
    () => (matchAll ? splitSearchTerms(debouncedKeyword) : [debouncedKeyword].filter(Boolean)),
    [debouncedKeyword, matchAll]
  );
  // A keyword without spaces is an ordinary search; keep that request unchanged.
  // The backend drops repeated terms, so only spacing decides the AND request.
  const matchAllTerms = matchAll && /\s/.test(debouncedKeyword);

  const handleMatchAllChange = useCallback((checked: boolean) => {
    setMatchAll(checked);
    try {
      localStorage.setItem(MATCH_ALL_STORAGE_KEY, String(checked));
    } catch {
      // Ignore storage write errors in private mode / restricted environments.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_SEARCH_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
        setRecentKeywords(sanitized.slice(0, MAX_RECENT_SEARCHES));
      }
    } catch {
      // Ignore storage parse errors and fallback to empty history.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    let cancelled = false;
    setIdMatch(null);
    // Current IDs are eight hex characters; also allow legacy safe ID tokens.
    // Do not pass free text, slashes or query delimiters into the detail route.
    const candidate =
      visible && keyword.trim() === debouncedKeyword && /^[a-z\d][a-z\d_-]{7,127}$/i.test(debouncedKeyword)
        ? debouncedKeyword
        : null;
    setIdLoading(candidate !== null);
    if (candidate) {
      const id = /^[a-f\d]{8}$/i.test(candidate) ? candidate.toLowerCase() : candidate;
      void getConversationOrNull(id)
        .then((conversation) => {
          if (!cancelled) setIdMatch(conversation);
        })
        .catch((error: unknown) => {
          if (!cancelled) console.error('[ConversationSearchPopover] ID lookup failed:', error);
        })
        .finally(() => {
          if (!cancelled) setIdLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword, keyword, visible]);

  const runSearch = useCallback(
    async (append: boolean) => {
      if (!visible || !debouncedKeyword || searchInFlight.current) return;
      searchInFlight.current = true;
      const generation = ++searchGeneration.current;
      const isCurrent = () => generation === searchGeneration.current;
      setSearchFailed(false);

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setItems([]);
        setHasMore(false);
        nextCursor.current = undefined;
        seenMessageIds.current.clear();
      }

      try {
        let remaining = PAGE_SIZE;
        while (isCurrent()) {
          const cursor = nextCursor.current;
          // Each scan depends on the cursor returned by its predecessor.
          // eslint-disable-next-line no-await-in-loop
          const result = await ipcBridge.database.searchConversationMessages.invoke({
            keyword: debouncedKeyword,
            cursor,
            page_size: remaining,
            ...(matchAllTerms ? { match_all: true } : {}),
          });
          if (!isCurrent()) return;

          const newItems = result.items.filter((item) => {
            if (seenMessageIds.current.has(item.message_id)) return false;
            seenMessageIds.current.add(item.message_id);
            return true;
          });
          // Publish hits before inspecting older ranges, including sparse ones.
          if (newItems.length) setItems((prev) => [...prev, ...newItems]);
          if (result.has_more && (!result.next_cursor || result.next_cursor === cursor)) {
            throw new Error('Message search did not advance its cursor');
          }
          nextCursor.current = result.next_cursor ?? undefined;
          setHasMore(result.has_more);
          remaining -= result.items.length;
          if (!result.has_more || remaining <= 0) break;
          // Yield between bounded scans; a closed/replaced search cannot start
          // another request, and React can paint partial results immediately.
          // eslint-disable-next-line no-await-in-loop
          await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
        }
      } catch (error) {
        if (!isCurrent()) return;
        console.error('[ConversationSearchPopover] Search failed:', error);
        setSearchFailed(true);
      } finally {
        if (isCurrent()) {
          searchInFlight.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedKeyword, matchAllTerms, visible]
  );

  useEffect(() => {
    searchGeneration.current += 1;
    searchInFlight.current = false;
    nextCursor.current = undefined;
    seenMessageIds.current.clear();
    setItems([]);
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
    setSearchFailed(false);
    if (keyword.trim() === debouncedKeyword) void runSearch(false);
    return () => {
      searchGeneration.current += 1;
      searchInFlight.current = false;
    };
  }, [debouncedKeyword, keyword, runSearch]);

  useEffect(() => {
    if (!debouncedKeyword) return;
    const normalized = debouncedKeyword.trim();
    if (!normalized) return;

    setRecentKeywords((prev) => {
      const nextKeywords = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, MAX_RECENT_SEARCHES);
      const unchanged =
        nextKeywords.length === prev.length && nextKeywords.every((item, index) => item === prev[index]);
      if (unchanged) {
        return prev;
      }

      try {
        localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(nextKeywords));
      } catch {
        // Ignore storage write errors in private mode / restricted environments.
      }

      return nextKeywords;
    });
  }, [debouncedKeyword]);

  const resetSearchState = useCallback(() => {
    searchGeneration.current += 1;
    setVisible(false);
    setKeyword('');
    setDebouncedKeyword('');
    setItems([]);
    setIdMatch(null);
    nextCursor.current = undefined;
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!visible || !debouncedKeyword || loading || loadingMore || !hasMore || searchFailed) {
      return;
    }

    void runSearch(true);
  }, [debouncedKeyword, hasMore, loading, loadingMore, runSearch, searchFailed, visible]);

  const handleResultClick = useCallback(
    async (item: ConversationSearchResult) => {
      blockMobileInputFocus();
      blurActiveElement();

      flushSync(() => {
        resetSearchState();
      });

      onConversationSelect?.();

      await Promise.resolve(
        navigate(`/conversation/${item.conversation.id}`, {
          state: {
            ...(item.message_id ? { targetMessageId: item.message_id } : {}),
            fromConversationSearch: true,
          },
        })
      );
      onSessionClick?.();
    },
    [navigate, onConversationSelect, onSessionClick, resetSearchState]
  );

  const handleClose = useCallback(() => {
    resetSearchState();
  }, [resetSearchState]);

  const handleClearKeyword = useCallback(() => {
    searchGeneration.current += 1;
    setKeyword('');
    setDebouncedKeyword('');
    setItems([]);
    setIdMatch(null);
    nextCursor.current = undefined;
    setHasMore(false);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const handleOpen = useCallback(() => {
    if (!disabled) {
      refreshConversationListPresence();
      setVisible(true);
    }
  }, [disabled, refreshConversationListPresence]);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (
        !isPrimaryApplicationShortcut(event, {
          key: 'f',
          shiftKey: true,
          targetGuard: 'embedded-editor',
        })
      ) {
        return;
      }
      // Preserve browser behavior in WebUI; only intercept in the desktop runtime.
      if (typeof window !== 'undefined' && !window.electronAPI) return;
      if (disabled) return;
      event.preventDefault();
      handleOpen();
    };

    document.addEventListener('keydown', handleGlobalSearchShortcut, true);
    return () => {
      document.removeEventListener('keydown', handleGlobalSearchShortcut, true);
    };
  }, [disabled, handleOpen]);

  const triggerAriaLabel = t('conversation.historySearch.tooltip');

  const results = useMemo<ConversationSearchResult[]>(
    () =>
      idMatch
        ? [
            {
              conversation: idMatch,
              message_created_at: idMatch.modified_at,
              preview_text: t('conversation.historySearch.conversationIdMatch', { id: idMatch.id }),
            },
            ...items,
          ]
        : items,
    [idMatch, items, t]
  );

  const resultContent = useMemo(() => {
    if (!debouncedKeyword) {
      return (
        <div className='conversation-search-modal__state'>
          <div className='conversation-search-modal__state-content'>
            <span className='text-13px'>{t('conversation.historySearch.idle')}</span>
            {recentKeywords.length > 0 ? (
              <div className='conversation-search-modal__recent-wrap'>
                {recentKeywords.map((item) => (
                  <button
                    key={item}
                    type='button'
                    className='conversation-search-modal__recent-chip'
                    onClick={() => setKeyword(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if ((loading || loadingMore || idLoading || keyword.trim() !== debouncedKeyword) && results.length === 0) {
      return (
        <div className='h-120px flex items-center justify-center'>
          <Spin size={20} />
        </div>
      );
    }

    const retrySearch = searchFailed ? (
      <div role='alert' className='py-8px flex items-center justify-center gap-8px text-12px text-t-secondary'>
        <span>{t('common.error')}</span>
        <Button type='text' onClick={() => void runSearch(true)}>
          {t('common.retry')}
        </Button>
      </div>
    ) : null;

    if (results.length === 0 && searchFailed) return retrySearch;

    if (results.length === 0) {
      return (
        <div className='conversation-search-modal__state'>
          <Empty className='py-2px' description={t('conversation.historySearch.empty')} />
        </div>
      );
    }

    return (
      <div
        className='h-full min-h-0 overflow-y-auto overflow-x-hidden pe-4px'
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollHeight - target.scrollTop - target.clientHeight < 48) {
            handleLoadMore();
          }
        }}
      >
        <div className='conversation-search-modal__results flex flex-col'>
          {results.map((item) => {
            const snippet = buildSnippet(item.preview_text, searchTerms);
            const active = activeConversationIds.has(item.conversation.id);
            const extra = item.conversation.extra;
            const workspace = extra?.workspace;
            const isTemporary = extra && 'is_temporary_workspace' in extra && extra.is_temporary_workspace === true;
            const hasProject =
              !isTemporary && Boolean(item.conversation.project_id || (extra?.custom_workspace && workspace));
            const locationLabel = active
              ? hasProject
                ? t('conversation.historySearch.locationProject')
                : t('conversation.historySearch.locationChats')
              : hasCompleteConversationList
                ? t('conversation.historySearch.locationArchived')
                : undefined;
            const projectPath = active && hasProject && workspace ? getParentAndCurrentDir(workspace) : undefined;
            return (
              <Button
                key={item.message_id ? `message:${item.message_id}` : `conversation:${item.conversation.id}`}
                type='text'
                className={classNames(
                  'conversation-search-modal__result w-full !h-auto !block !whitespace-normal !text-start !rounded-none cursor-pointer transition-all duration-150',
                  'focus:outline-none'
                )}
                onClick={() => {
                  void handleResultClick(item);
                }}
              >
                <div className='flex items-start justify-between gap-8px mb-6px'>
                  <div className='min-w-0 flex-1'>
                    <div className='conversation-search-modal__result-title-row'>
                      <span className='relative inline-flex flex-shrink-0'>
                        <ConversationAgentMark conversation={item.conversation} />
                        <ConversationClaudeAccountBadge conversation={item.conversation} />
                      </span>
                      <div className='conversation-search-modal__result-title text-15px font-600 text-t-primary truncate'>
                        <MindNProgressTitle conversationId={item.conversation.id}>
                          {item.conversation.name || t('conversation.historySearch.untitled')}
                        </MindNProgressTitle>
                      </div>
                    </div>
                  </div>
                  <span className='shrink-0 text-11px text-t-secondary'>
                    {formatTime(item.message_created_at, i18n.language)}
                  </span>
                </div>
                {locationLabel ? (
                  <div className='mb-4px flex items-start gap-4px text-11px text-t-secondary'>
                    <span className='shrink-0'>{locationLabel}</span>
                    {projectPath ? (
                      <span className='min-w-0 break-all' title={workspace}>
                        · {projectPath}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className='conversation-search-modal__snippet text-13px leading-22px text-t-primary/92 break-words'>
                  {renderHighlightedText(snippet, searchTerms)}
                </div>
              </Button>
            );
          })}

          {(loading || loadingMore) && (
            <div className='py-8px flex items-center justify-center gap-8px text-12px text-t-secondary'>
              <Spin size={14} />
              <span>{t('conversation.historySearch.loadingMore')}</span>
            </div>
          )}
          {retrySearch}
          {hasMore && !loading && !loadingMore && !searchFailed && (
            <Button type='text' onClick={handleLoadMore}>
              {t('common.more')}
            </Button>
          )}
        </div>
      </div>
    );
  }, [
    debouncedKeyword,
    keyword,
    handleLoadMore,
    handleResultClick,
    results,
    activeConversationIds,
    hasCompleteConversationList,
    loading,
    idLoading,
    loadingMore,
    hasMore,
    runSearch,
    searchFailed,
    searchTerms,
    recentKeywords,
    t,
    i18n.language,
  ]);

  const hasSearchResults = results.length > 0;
  const useCompactHeight = !debouncedKeyword || (!loading && !loadingMore && !idLoading && !hasSearchResults);
  const triggerClassName = fullWidth
    ? 'conversation-search-trigger-full h-34px w-full p-0 bg-transparent border-none outline-none flex items-center justify-start gap-8px ps-10px pe-8px rd-0.5rem cursor-pointer shrink-0 transition-all group text-t-primary focus:outline-none focus-visible:outline-none'
    : 'h-34px w-34px p-0 bg-transparent rd-0.5rem flex items-center justify-center cursor-pointer shrink-0 transition-all border border-solid border-transparent text-t-secondary hover:text-t-primary';

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: handleOpen, isActive: visible })
      ) : (
        <button
          type='button'
          aria-label={triggerAriaLabel}
          className={classNames(
            triggerClassName,
            {
              'hover:bg-fill-3 active:bg-fill-4': !disabled && fullWidth,
              'hover:bg-fill-2 hover:border-[color:var(--color-border-2)]': !disabled && !fullWidth,
              'opacity-50 cursor-not-allowed': disabled,
              'bg-aou-2 text-primary border-[color:var(--color-primary-light-3)]': visible && !disabled && !fullWidth,
            },
            buttonClassName
          )}
          onClick={handleOpen}
          disabled={disabled}
        >
          {fullWidth ? (
            <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
              <Search
                theme='outline'
                size='16'
                fill='currentColor'
                className='block leading-none'
                style={{ lineHeight: 0 }}
              />
            </span>
          ) : (
            <Search
              theme='outline'
              size='16'
              fill='currentColor'
              className='block leading-none shrink-0'
              style={{ lineHeight: 0 }}
            />
          )}
          {fullWidth && label ? (
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
          ) : null}
        </button>
      )}

      <AionModal
        visible={visible}
        onCancel={handleClose}
        footer={null}
        showCustomClose={false}
        unmountOnExit
        className='conversation-search-modal'
        maskStyle={{
          background: 'var(--conversation-search-mask-bg)',
          backdropFilter: 'blur(1px)',
          WebkitBackdropFilter: 'blur(1px)',
        }}
        style={{
          width: 'min(700px, calc(100vw - 56px))',
          borderRadius: '24px',
          background: 'transparent',
          boxShadow: 'none',
        }}
        contentStyle={{
          background: 'transparent',
          borderRadius: '24px',
          padding: '0',
          overflow: 'hidden',
          height: useCompactHeight ? 'auto' : 'min(70vh, 720px)',
          minHeight: useCompactHeight ? '300px' : undefined,
          maxHeight: 'min(70vh, 720px)',
        }}
      >
        <div
          className={classNames('conversation-search-modal__panel flex flex-col', {
            'h-full min-h-0': !useCompactHeight,
          })}
        >
          <div className='conversation-search-modal__header'>
            <div className='conversation-search-modal__header-main'>
              <div className='conversation-search-modal__title'>{t('conversation.historySearch.title')}</div>
              <Typography.Paragraph className='conversation-search-modal__description !mb-0 text-13px text-t-secondary'>
                {t('conversation.historySearch.description')}
              </Typography.Paragraph>
            </div>
            <button
              type='button'
              className='conversation-search-modal__close-btn'
              onClick={handleClose}
              aria-label='Close'
            >
              <Close size={16} />
            </button>
          </div>

          <div className='mb-14px conversation-search-modal__input-wrap flex items-center gap-12px'>
            <AionSearchInput
              className='flex-1 min-w-0'
              autoFocus={visible}
              value={keyword}
              placeholder={t('conversation.historySearch.placeholder')}
              onChange={setKeyword}
              onClear={handleClearKeyword}
            />
            <Tooltip content={t('conversation.historySearch.matchAllTooltip')}>
              <Checkbox className='shrink-0 whitespace-nowrap' checked={matchAll} onChange={handleMatchAllChange}>
                {t('conversation.historySearch.matchAll')}
              </Checkbox>
            </Tooltip>
          </div>

          <div className='flex-1 min-h-0'>{resultContent}</div>
        </div>
      </AionModal>
    </>
  );
};

export default ConversationSearchPopover;
