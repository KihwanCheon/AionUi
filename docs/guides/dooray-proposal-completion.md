# Dooray proposal completion indicators

The personal fork automatically reads completion notifications for MnP's dedicated Dooray routing and proposal-writing conversations. These conversations remain visible in history; their messages, runtime, and task status are not changed.

- Identification uses `extra.mnpDoorayResponseId` and its matching `extra.mnpDoorayOperationId`, not the conversation name or workspace. MnP already supplies these markers when creating proposal conversations.
- Both stream termination and turn completion use the same renderer-local policy. The conversation dot, collapsed-project dot, and taskbar completion count therefore agree.
- Existing marked conversations are reconciled whenever history loads or refreshes. No database migration or read-state write is needed.
- A completion that arrives before its metadata waits for a single conversation metadata lookup. Failed, invalid, or timed-out lookups retain the normal unread notification; a later successful history refresh removes it if the conversation is a dedicated proposal chat.
- Explicitly reading or deleting a conversation cancels pending notification decisions so a late response cannot recreate its dot.
- Manually marked unread state, running indicators, and permission/question prompts are preserved. Normal card handoff, approval execution, and root handoff conversations retain their completion notifications.
- This policy does not change MnP's proposal-arrived, additional-information, approval, or response-completed states. It also does not change separate desktop toast or sound settings.

The logic lives in the history renderer's `doorayCompletionRead` helper to keep MnP-specific rules out of upstream completion and runtime handling. Focused policy and event-wiring tests cover normal and failed lookups, out-of-order delivery, both completion event paths, and preserved manual/runtime state. No prompt or message content is queried or logged.

## Repeated upstream rebase contract

Feature ID: `dooray-proposal-auto-read`. Preserve behavior rather than a particular commit hash or line number.

Keep the identification rules, metadata cache, lookup timeout, deduplication, and late-response cancellation in the fork-only helper. Its dependencies are callbacks, not the IPC bridge, React, or the history store. Tests and this guide are also fork-only files. Do not spread the policy across conversation rows, project headers, taskbar rendering, individual terminal events, or AionCore API/schema files.

The upstream-owned `useConversationListSync` module has only these integration boundaries (plus the import):

1. Successful history refresh passes the original conversation metadata to `reconcile`.
2. The central completion-state boundary binds `markCompletionUnread` and `clearCompletionUnreadState` to the policy. Raw set mutations and store notifications remain in the store's `commitCompletionUnread` / `commitCompletionRead` callbacks. Existing terminal-event and focus/read callers stay unchanged. Future completion paths must use the same boundary.
3. Conversation deletion calls `forget` after the normal read-state cleanup to invalidate cached metadata and pending decisions.

The policy's public `clearCompletion` cancels pending work before clearing unread. Do not wire it back into its own raw `clearUnread` callback. Unknown metadata must fail open after at most five seconds; metadata lookup failures must never silently hide normal completions. Explicit read, focus, or deletion must not be undone by late lookup results.

For each upstream rebase:

1. Inspect these boundaries and any changes to conversation `extra`, terminal-event delivery, or completion-state ownership, even if Git reports no conflict. Keep upstream runtime/confirmation logic; reconnect the policy at its equivalent state boundary if that code moves.
2. Run the focused policy and real-store event-wiring tests below, then the adjacent completion/manual-unread/runtime/taskbar regressions. Do not rely on text snapshots of the hook or a one-time conflict-free dry-run.
3. Verify normal, approval-execution, card-handoff, and root-handoff conversations still notify; dedicated route/review conversations do not. Manual unread, generation, permission/question prompts, and separate desktop toast/sound settings must remain unchanged.
4. If upstream adds an equivalent notification policy, verify these contracts before replacing the fork helper. Do not automatically retain two competing read-state implementations.

```powershell
bun run test tests/unit/renderer/pages/GroupedHistory tests/unit/renderer/layout/completionUnread.dom.test.ts tests/unit/renderer/hooks/useConversationListSyncManualUnread.dom.test.tsx tests/unit/renderer/hooks/getSnapshotConversationName.dom.test.tsx tests/unit/conversation/runtime/conversationListSyncGuard.test.ts tests/unit/conversation/runtime/conversationListSyncReconcile.dom.test.ts tests/unit/conversation/runtime/conversationListSyncWaiting.test.ts tests/unit/process/services/taskbarBadge.test.ts tests/unit/common-adapter/apiModelMapper.test.ts
```

Run the fork push gate (`just push-fork`) when a push is authorized. Public history normalization, an actual upstream rebase, full-suite testing, and package builds are separate operations, not prerequisites for editing this feature. A conflict-free dry-run is a current-state check, not a guarantee about future upstream changes.
