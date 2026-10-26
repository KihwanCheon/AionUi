/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Claude subscription accounts (personal fork). Mirrors the AionCore
 * `claude_account` API types. A conversation bound to a non-default account
 * carries `extra.claude_account_id`; without it the default account is used.
 */

export const DEFAULT_CLAUDE_ACCOUNT_ID = 'default';

/** Compact entry shared by every client; `number` is the 1-based shared order. */
export type ClaudeAccountSummary = {
  id: string;
  number: number;
  label: string;
};

export type ClaudeAccount = ClaudeAccountSummary & {
  config_dir?: string;
  is_default: boolean;
  share_default_settings: boolean;
};

export type ClaudeAccountAuthStatus = {
  logged_in: boolean;
  subscription_type?: string;
  email?: string;
};

export type CreateClaudeAccountRequest = {
  label: string;
  config_dir: string;
  default_label?: string;
  share_default_settings?: boolean;
};

export type UpdateClaudeAccountRequest = {
  label?: string;
  share_default_settings?: boolean;
};
