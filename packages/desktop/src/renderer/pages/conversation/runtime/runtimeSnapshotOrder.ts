/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';

export type RuntimeSnapshotOrder = {
  latest: TConversationRuntimeSummary | null;
  retiredInstances: Set<string>;
};

/** Keep newer realtime state when an older HTTP response arrives afterwards. */
export const selectRuntimeSnapshot = (
  incoming: TConversationRuntimeSummary,
  order: RuntimeSnapshotOrder
): TConversationRuntimeSummary => {
  const previous = order.latest;
  const instance = incoming.runtime_instance_id;
  const previousInstance = previous?.runtime_instance_id;
  if (previous && previousInstance) {
    if (!instance || order.retiredInstances.has(instance)) return previous;
    if (instance === previousInstance && (incoming.runtime_revision ?? 0) < (previous.runtime_revision ?? 0)) {
      return previous;
    }
    if (instance !== previousInstance) order.retiredInstances.add(previousInstance);
  }
  order.latest = incoming;
  return incoming;
};
