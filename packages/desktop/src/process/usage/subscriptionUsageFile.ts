/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SubscriptionUsageSnapshot } from '@/common/types/platform/subscriptionUsage';

export const AIONUI_SUBSCRIPTION_USAGE_FILE = 'aionui-subscription-usage.json';

type SubscriptionUsageFileOptions = {
  tempDirectory?: string;
  pid?: number;
  replaceFile?: (source: string, destination: string) => void;
};

type ClearSubscriptionUsageFileOptions = Omit<SubscriptionUsageFileOptions, 'replaceFile'> & {
  expectedContent?: string;
};

export const getSubscriptionUsagePath = (tempDirectory = tmpdir()): string =>
  path.join(tempDirectory, AIONUI_SUBSCRIPTION_USAGE_FILE);

const getPendingPath = (options: SubscriptionUsageFileOptions): string =>
  `${getSubscriptionUsagePath(options.tempDirectory)}.${options.pid ?? process.pid}.tmp`;

export const serializeSubscriptionUsageSnapshot = (snapshot: SubscriptionUsageSnapshot): string =>
  `${JSON.stringify(snapshot)}\n`;

export const writeSubscriptionUsageSnapshot = (
  snapshot: SubscriptionUsageSnapshot,
  options: SubscriptionUsageFileOptions = {}
): string => {
  const content = serializeSubscriptionUsageSnapshot(snapshot);
  const targetPath = getSubscriptionUsagePath(options.tempDirectory);
  const pendingPath = getPendingPath(options);
  let descriptor: number | undefined;

  try {
    rmSync(pendingPath, { force: true });
    descriptor = openSync(pendingPath, 'w', 0o600);
    writeFileSync(descriptor, content, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    (options.replaceFile ?? renameSync)(pendingPath, targetPath);
    return content;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Ignore a close failure while preserving the original write error.
      }
    }
    rmSync(pendingPath, { force: true });
    throw error;
  }
};

export const clearSubscriptionUsageSnapshot = (options: ClearSubscriptionUsageFileOptions = {}): boolean => {
  rmSync(getPendingPath(options), { force: true });
  if (options.expectedContent === undefined) return false;

  const targetPath = getSubscriptionUsagePath(options.tempDirectory);
  try {
    if (readFileSync(targetPath, 'utf8') !== options.expectedContent) return false;
    rmSync(targetPath, { force: true });
    return true;
  } catch {
    return false;
  }
};
