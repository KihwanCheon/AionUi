/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  createWebExternalConversationLaunchSession,
  readExternalConversationLaunch,
  readExternalConversationLaunchToken,
  type ExternalConversationLaunchSession,
} from '@/renderer/services/externalConversationLaunch';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export type ExternalConversationLaunchError =
  | 'already-used'
  | 'load-failed'
  | 'not-found-or-expired'
  | 'unavailable-options';

type ExternalConversationLaunchSessionState = {
  error: ExternalConversationLaunchError | null;
  loading: boolean;
  markUnavailable: () => void;
  retry: () => void;
  session: ExternalConversationLaunchSession | null;
};

export function useExternalConversationLaunchSession(
  onCallbackPending: () => void
): ExternalConversationLaunchSessionState {
  const location = useLocation();
  const navigate = useNavigate();
  const desktopSession = useMemo(() => readExternalConversationLaunch(location.search), [location.search]);
  const launchId = useMemo(() => readExternalConversationLaunchToken(location.search), [location.search]);
  const [retrySequence, setRetrySequence] = useState(0);
  const [session, setSession] = useState<ExternalConversationLaunchSession | null>(desktopSession);
  const [error, setError] = useState<ExternalConversationLaunchError | null>(null);
  const [loading, setLoading] = useState(Boolean(launchId && !desktopSession));

  useEffect(() => {
    if (!launchId || desktopSession) {
      setSession(desktopSession);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setSession(null);
    setError(null);
    setLoading(true);
    void createWebExternalConversationLaunchSession(launchId, onCallbackPending)
      .then((resolvedSession) => {
        if (!active) return;
        setSession(resolvedSession);
        setLoading(false);
      })
      .catch((claimError: unknown) => {
        if (!active) return;
        const errorCode = isBackendHttpError(claimError) ? claimError.code : '';
        setError(
          errorCode === 'EXTERNAL_LAUNCH_NOT_FOUND_OR_EXPIRED'
            ? 'not-found-or-expired'
            : errorCode === 'EXTERNAL_LAUNCH_ALREADY_CLAIMED'
              ? 'already-used'
              : 'load-failed'
        );
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [desktopSession, launchId, onCallbackPending, retrySequence]);

  const preparedWebLaunchTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (session?.source !== 'web') return;
    if (preparedWebLaunchTokenRef.current === session.token) return;
    preparedWebLaunchTokenRef.current = session.token;
    const navigationState =
      location.state && typeof location.state === 'object' ? (location.state as Record<string, unknown>) : {};
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: {
        ...navigationState,
        selectedAssistantId: `bare:${session.launch.agentId}`,
        prefillPrompt: session.launch.prompt,
        workspace: session.launch.workspace,
      },
    });
  }, [location.pathname, location.search, location.state, navigate, session]);

  const markUnavailable = useCallback(() => {
    setSession(null);
    setError('unavailable-options');
    setLoading(false);
  }, []);
  const retry = useCallback(() => setRetrySequence((current) => current + 1), []);

  return { error, loading, markUnavailable, retry, session };
}
