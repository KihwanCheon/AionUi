# Conversation identity and adjacent activity

Feature ID: `conversation-leading-status`. Preserve the behavior across repeated upstream rebases rather than preserving a particular commit or selector.

The conversation row keeps its existing provider/assistant leading mark at normal opacity while a turn is generating. The original 16px Arco spinner appears on its leading side (left in LTR layouts), rather than replacing or surrounding it. The bookmark star sits just before status with approximately 2px between their painted outlines, without changing row padding or flow widths. In expanded project/cron rows status occupies the original bookmark center and the star moves toward it from the leading gutter. Compact top-level rows use the existing bookmark/identity gap for status, avoiding clipping the star at the row edge. The bookmark stays in its new position while idle, generating, or awaiting confirmation. Collapsed rows have no bookmark and retain the status beside the centered identity. The identity stays in its existing 22px slot and the status is absolutely positioned, so the row reserves no new horizontal space and the title does not move when activity starts. Existing cron identity precedence is unchanged. Both the main and bookmarked lists share this row, including mobile/tablet layouts.

## Integration boundaries

- `GroupedHistory/components/ConversationLeadingStatus.tsx` owns decorative activity presentation only. Use the original `Spin size={16}` and existing attention icon, preserving their shape, color, stroke, and animation. The absolute status wrapper ignores pointer events; do not reduce identity opacity or apply animation to the identity.
- `ConversationRow.tsx` passes the existing leading mark as children plus the existing generation/confirmation/batch flags. No new runtime subscription, polling, state source, or AionCore change is required.
- `ConversationBookmarkButton.tsx` translates only the rendered button; its 20px flow slot remains reserved. The translation follows `statusLayout`, not generation state, and reverses in RTL. Keep the real clickable button and tooltip at the visual location, preserving click propagation isolation.
- Unpinned desktop bookmarks are revealed by row hover or `focus-visible`, not generic `focus`. Pointer pin/unpin leaves native button focus behind; that residual focus must not keep the star visible after the pointer leaves. Preserve keyboard Tab visibility without blurring the button, and keep pinned/mobile bookmarks always visible.
- Confirmation takes precedence over generation: keep the identity and display the original attention icon in the adjacent status position instead of the spinner. Batch selection suppresses both decorations. A completion-unread dot remains visible at the row's trailing edge while a newer turn is generating or awaiting confirmation, so every taskbar count has a matching sidebar marker.
- Pinned identity fades on hover only when the desktop idle-row drag/pin overlay is actually available. Generating/waiting identity must not disappear on hover. Preserve idle drag-handle click isolation and normal row selection.

## For every upstream rebase

1. Check row identity resolution, status precedence, pinned hover/drag presentation, shared all/bookmarked rendering, and the 22px slot even if Git reports no conflict. Preserve these semantic connections if upstream moves the row or its status flags. Expanded indented status uses a -26px offset from the identity slot; compact/collapsed status uses -12px. Gutter bookmarks translate -15px; compact bookmarks translate -1px. RTL reverses the translations. With the existing 14px star and 16px spinner SVG geometry, their painted outlines are about 1.92px apart. If upstream changes bookmark width, SVG geometry, indentation, or row gaps, remeasure the painted gap, unchanged identity/title geometry, and absence of clipping or glyph collisions.
2. Run the focused tests below. Preserve identity plus the adjacent original spinner, not the former mutually exclusive rendering or the discarded outer-ring design.
3. Visually verify the generating spinner beside the fully opaque provider logo, confirmation precedence, and pinned hover in expanded/collapsed lists on desktop and a touch device. The DOM tests verify composition and state transitions, not final browser paint or animation geometry. Verify the approximately 2px star/status painted gap, fixed bookmark position through state transitions, unchanged identity/title geometry, no clipping at the row edge, and bookmark hit testing while generating. Check RTL as well as LTR.
4. If upstream supplies equivalent behavior, verify the same contracts before replacing the fork helper. Do not maintain duplicate activity decorations.

```powershell
bun run test tests/unit/renderer/pages/GroupedHistory/conversationLeadingStatus.dom.test.tsx tests/unit/renderer/pages/GroupedHistory/conversationBookmarkButton.dom.test.tsx tests/unit/conversation/conversationRowWaitingIcon.dom.test.tsx tests/unit/conversation/SortableConversationRow.dom.test.tsx tests/unit/renderer/conversation/ConversationRowManualUnread.dom.test.tsx tests/unit/renderer/conversation/ConversationRowCronMenu.dom.test.tsx tests/unit/renderer/layout/completionUnread.dom.test.ts
```

## Failed turn visibility

An unread terminal error uses a static danger-colored attention icon in the same adjacent slot, while keeping the provider identity visible. Confirmation and generation take precedence; batch mode hides the error decoration. Collapsed project headers retain that priority while overlaying a completion-unread dot when another child has an unread successful completion. The error icon has an accessible label and a tooltip with the provider reason; its inner span permits pointer events for the tooltip without blocking row selection.

`utils/conversationFailure.ts` reconciles the last persisted result and stores per-turn read receipts in localStorage. Opening the conversation acknowledges the error; changing lists or reloading must not discard an unread failure or resurrect an acknowledged one. Late terminals must not clear a newer known turn. Native and browser notifications use the existing settings/focus gates, distinguish failure from success, deduplicate per conversation/turn, and navigate to the failed conversation.

AionCore preserves partial assistant text and always persists the terminal error as a separate `tips` row. Its stable `error:<conversation_id>:<reply_msg_id>` identity matches the live error and deduplicates replay. Error tips have a separate message-index key so they never replace partial text. The latest outcome is stored atomically in `extra.last_turn_result` as `{ turn_id, status: 'error' | 'finish', completed_at, error?: string }`; the detailed error remains in the message row. This preserves concurrent unrelated extra fields and lets list state recover even when the app missed the terminal frame. Persisted send-failure tips (`type=tips`, `status=error`, `replace=true`) are also terminal; advisory tips are not.

```powershell
bun run test tests/unit/renderer/pages/GroupedHistory/conversationFailure.dom.test.ts tests/unit/conversation/runtime/retryTipMerge.test.ts tests/unit/renderer/browserNotificationCore.test.ts tests/unit/renderer/useBrowserNotification.dom.test.tsx tests/unit/renderer/useDesktopTurnNotification.dom.test.tsx
```

Renderer changes support development HMR. The failure persistence contract also requires a rebuilt AionCore and a later app restart; do not restart while other conversations are executing. The parent `run-aionui-dev-no-sentry.bat` compiles the UI sources on startup, so no UI package build is required.

## Stop capability during CLI continuations

The input's Stop action uses `runtime.can_stop` and `runtime.cancel_turn_id`, independently of `is_processing`, `can_send_message`, and the foreground `turn_id`. A CLI continuation can remain stoppable after its user turn releases the input. This shared Session behavior has no model-name condition. Callers without the new fields keep the foreground-turn fallback.

AionCore registers the continuation's cancellation target without taking the message-admission claim. Finish, source closure, watcher teardown, or a foreground takeover releases it; silence alone is not completion. The cancel endpoint validates the target again before closing admission and calling the existing agent cancellation API. The existing cancel timeout also covers continuations. A stale stop must not interrupt a newer foreground turn.

`conversation.runtimeChanged` carries the runtime snapshot when a continuation starts or ends. Completion snapshots are published after releasing the target. The UI orders snapshots by `runtime_instance_id` and `runtime_revision`, preserving newer realtime state against delayed HTTP responses. Opening a conversation, reconnecting, and returning window focus refresh the snapshot. Draft sending and team SendBox behavior retain their existing policies.

Focused regression checks cover the runtime view store, runtime hook, `AcpSendBox`, and `SendBox` DOM behavior. Core checks cover `runtime_state`, `background_stream`, and cancellation service tests, including ten minutes without output and old-target rejection. Real CLI interruption still requires a rebuilt Core and a later live verification; do not infer it from DOM or mock-agent tests.
