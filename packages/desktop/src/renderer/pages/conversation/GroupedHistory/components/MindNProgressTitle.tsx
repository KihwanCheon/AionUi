/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useMindNProgressConversationLink,
  type MindNProgressConversationApi,
} from '@/renderer/components/chat/SendBox/MindNProgressConversationLink';

/** Overlay current MnP roles without renaming conversations or fetching off-screen rows. */
const MindNProgressTitle: React.FC<{
  children: React.ReactNode;
  disabled?: boolean;
  conversationId?: string;
  active?: boolean;
  api?: MindNProgressConversationApi;
}> = ({ children, disabled, conversationId = '', active = false, api }) => {
  const { t } = useTranslation();
  const elementRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!conversationId || active || typeof children !== 'string') return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const element = elementRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [conversationId, active, typeof children]);
  const { state } = useMindNProgressConversationLink(conversationId, api, {
    enabled: Boolean(conversationId) && (active || visible),
    active,
  });
  if (typeof children !== 'string') return <>{children}</>;

  const prefix = /^(\[(상위|그룹 총괄)(?:·보조)?\])(?=\s|$)/.exec(children);
  const target = state.status === 'linked' ? state.link.target : undefined;
  const role = target?.conversationRole;
  const auxiliary = role === 'auxiliary';
  const workflow = /^\[(?:배치 제안|Dooray 승인|문서 정리|지식정리)\]/.test(children);
  const cardRole = target?.cardRole;
  const roleLabel = workflow
    ? ''
    : cardRole === 'group-coordinator'
      ? t('messages.mindnprogress.roleCoordinator')
      : cardRole === 'document-root'
        ? t('messages.mindnprogress.roleRoot')
        : cardRole === 'card'
          ? ''
          : (prefix?.[2] ?? '');
  const coordinator = cardRole === 'group-coordinator' || (!cardRole && prefix?.[2] === '그룹 총괄');
  const body = prefix ? children.slice(prefix[0].length).trimStart() : children;
  const tooltip =
    role === 'primary'
      ? t('messages.mindnprogress.rolePrimaryTooltip')
      : auxiliary
        ? target?.primaryConversationId === null
          ? t('messages.mindnprogress.roleNoPrimaryTooltip')
          : t('messages.mindnprogress.roleAuxiliaryTooltip')
        : t('messages.mindnprogress.roleUnknownTooltip');

  // Arco RGB tokens use commas; a raw color property avoids UnoCSS adding slash opacity.
  return (
    <span
      ref={elementRef}
      title={target || prefix ? tooltip : undefined}
      data-mnp-conversation-role={role ?? 'unknown'}
    >
      {(roleLabel || auxiliary) && (
        <span
          className={
            disabled
              ? undefined
              : coordinator
                ? 'text-[color:color-mix(in_srgb,var(--primary)_75%,var(--text-primary))]'
                : 'text-[color:color-mix(in_srgb,var(--brand)_80%,var(--text-primary))] [html[data-theme=dark]_&]:[color:rgb(var(--purple-7))]'
          }
        >
          {'['}
          {roleLabel}
          {auxiliary && (
            <span className='text-[color:color-mix(in_srgb,currentColor_70%,var(--color-black))]'>
              {roleLabel ? '·' : ''}
              {t('messages.mindnprogress.roleAuxiliary')}
            </span>
          )}
          {'] '}
        </span>
      )}
      {body}
    </span>
  );
};

export default MindNProgressTitle;
