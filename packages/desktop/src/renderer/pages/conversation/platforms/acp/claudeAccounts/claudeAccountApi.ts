/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpDelete, httpGet, httpPatch, httpPost, httpPut } from '@/common/adapter/httpBridge';
import type {
  ClaudeAccount,
  ClaudeAccountAuthStatus,
  CreateClaudeAccountRequest,
  UpdateClaudeAccountRequest,
} from '@/common/types/platform/claudeAccount';

const accountPath = (id: string): string => `/api/claude-accounts/${encodeURIComponent(id)}`;

/**
 * AionCore Claude account routes (personal fork). Providers are created on
 * call so importing the badge or selector never touches the HTTP layer.
 */
export const claudeAccountApi = {
  list: (): Promise<ClaudeAccount[]> => httpGet<ClaudeAccount[]>('/api/claude-accounts').invoke(),
  create: (request: CreateClaudeAccountRequest): Promise<ClaudeAccount> =>
    httpPost<ClaudeAccount, CreateClaudeAccountRequest>('/api/claude-accounts').invoke(request),
  update: (id: string, patch: UpdateClaudeAccountRequest): Promise<ClaudeAccount> =>
    httpPatch<ClaudeAccount, UpdateClaudeAccountRequest>(accountPath(id)).invoke(patch),
  remove: (id: string): Promise<null> => httpDelete<null>(accountPath(id)).invoke(),
  reorder: (ids: string[]): Promise<ClaudeAccount[]> =>
    httpPut<ClaudeAccount[], { ids: string[] }>('/api/claude-accounts/order').invoke({ ids }),
  authStatus: (id: string): Promise<ClaudeAccountAuthStatus> =>
    httpGet<ClaudeAccountAuthStatus>(`${accountPath(id)}/auth-status`).invoke(),
};
