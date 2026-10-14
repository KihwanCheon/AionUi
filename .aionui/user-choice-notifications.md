# Prose-question choice notifications

Feature ID: `prose-user-choice-notifications`. Preserve this behavior across repeated upstream rebases, not particular commits or selectors.

## User-visible contract

- A real prose question requiring a user choice, approval, or answer is accompanied by a standalone `[[AIONUI_USER_CHOICE_REQUIRED]]` line. This includes a new approval request at the end of a plan, review, or progress report before starting implementation or applying a proposed change. Arbitrary question wording is not classified heuristically.
- The global titlebar bell is labeled **User attention needed** and combines prose questions with unread terminal errors. It counts distinct conversations across both sources, independent of bookmarks, history period filters, or collapsed sidebar. Both types remain separate entries when they belong to the same conversation. Desktop/tablets use a popup; narrow phones use a bottom sheet.
- Selecting a question entry opens its originating conversation and navigates to its persisted message anchor using the existing chat message-jump mechanism. It does not dismiss the question or add composer focus behavior.
- Sending a visible user message resolves every existing question entry from that conversation before a later assistant question can register. Programmatic agent turns, hidden messages, opening the conversation, finishing/interruption, and any AI resolution marker do not resolve questions. The user's explicit **Dismiss notification** action removes only the selected entry; dismissal is not an approval, reply, or command to an AI.
- Error entries show their provider reason (or the existing error fallback), open the failed conversation, and acknowledge the same per-turn read receipt as the sidebar. Dismissing an error also acknowledges that receipt. Reading an error never dismisses an independent question or retries/approves an AI action. Sidebar reads and notifications stay synchronized, including reload recovery; do not duplicate failure state in the choice store.
- AionCore owns pending entries and durable resolution/dismissal tombstones per backend user. Every device loads the same snapshot when it opens, and connected devices replace their local mirror from `conversation.choiceNoticesChanged` events. Legacy browser-local v1 queues are ignored because they cannot distinguish unanswered entries from questions that were already answered.
- The conversation's separate warning badge coexists with its original provider identity, spinner, and bookmark. A collapsed project group shows a warning alongside its existing aggregate status. Both All and Bookmarks supply their collapsed group members. Titles may truncate to reserve right-side space; left-side geometry stays unchanged.
- Only visible assistant text is inspected. User messages, thinking, tool output, hidden messages, teammate content, quoted/inline/indented/fenced examples do not register notifications. The same message's streamed fragments share stable notification keys; multiple markers in one message remain independently dismissible. An identical non-empty question repeated in a later assistant message replaces the older entry and navigates to the newer message.
- No polling, extra CLI invocation, natural-language inference, or changes to actual confirmation/approval state are introduced. Parser scratch buffers and previews are bounded.

## Instruction boundary (AionCore)

`aionui-ai-agent`'s fork-only `capability/user_choice_notice.rs` adds registration-only guidance to the outbound `AgentInstance` send and mid-turn delivery boundaries. The original persisted user message, attachment paths, correlation IDs, preset rules, and selected skills are unchanged. Slash commands are byte-identical. Existing conversations receive guidance on their next request; ongoing requests cannot retroactively receive it.

The guidance remains in English, but the entire response follows the user's explicitly requested language or the current conversation's language. The instruction's own language does not select the response language. A new prose approval request must identify the action and scope in an explicit marked question rather than end with an indirect offer to proceed after approval. An already marked request is not repeated merely as a reminder, and already authorized work does not acquire a new approval requirement.

The instruction preserves authority boundaries: unanswered choices do not authorize dependent actions, but previously authorized independent work may continue. Resolution comes from a visible user-message event rather than an AI-generated marker or auto-dismissal. AI adherence is best-effort; unit tests prove instruction delivery and explicit-marker UI behavior, not every model's future compliance.

## Rebase integration seams

1. Keep the isolated `UserChoiceNotifications` context feature mounted at the shared layout boundary. Retain exactly one global subscription each for `message.stream`, `message.userCreated`, and `conversation.choiceNoticesChanged` even when conversation routes or filters change. Preserve the user-versus-agent-turn source discriminator in AionCore.
2. Keep the titlebar trigger mounted outside the active-chat subtree and outside desktop-only gates. Verify touch breakpoints and native window drag exclusion.
3. Keep row warnings separate from `isWaitingConfirmation`: a prose question does not imply the agent has stopped. Keep warning placement clear of hover menus, unread dots, and collapsed identity/spinner geometry.
4. Reconnect both All and Bookmarks' collapsed group members if upstream moves history grouping. Do not treat group/filter visibility as notification resolution.
5. Keep the same outbound prompt guidance at normal and mid-turn send boundaries if AionCore reorganizes dispatch. Verify slash commands and persisted message content against the then-current implementation.
6. Preserve stable conversation/message/marker-index keys and AionCore's user-scoped persistence. User sends resolve the originating conversation's existing questions; manual dismissal remains available for individual entries. Do not replace either path with generic unread-clearing logic.
7. Keep localization keys in every supported locale and regenerate i18n types.
8. Preserve `useAttentionNotifications`' presentation-only combination and the `useUnreadConversationFailures` selector on the existing history store. Reconnect this small seam if upstream moves failure tracking. Both sources have distinct lifecycle and storage policies: never replace manually dismissed questions with automatically read failures or add another error-stream listener/polling loop.

## Focused verification

```powershell
bun run test tests/unit/renderer/pages/GroupedHistory/userChoiceNotifications.test.ts tests/unit/renderer/pages/GroupedHistory/userChoiceNotifications.dom.test.tsx tests/unit/renderer/pages/GroupedHistory/conversationFailure.dom.test.ts tests/unit/renderer/pages/GroupedHistory/conversationLeadingStatus.dom.test.tsx tests/unit/renderer/pages/GroupedHistory/conversationBookmarkButton.dom.test.tsx tests/unit/renderer/layout/TitlebarWorkspaceToggle.dom.test.tsx tests/unit/renderer/layout/completionUnread.dom.test.ts
```

For AionCore run `cargo test -p aionui-ai-agent user_choice_notice --lib`, the focused `aionui-db` choice-notice repository tests, and the focused `aionui-conversation` choice-notice service tests. Verify the emitted prompt contract through the `AgentInstance` boundary; do not claim model/CLI compliance from synthetic fixtures alone. For visual verification, use an isolated browser fixture to check desktop popup, tablet placement, phone sheet, warning/spinner co-visibility, right-side hover-menu separation, and cross-device snapshot restoration.

With the development server running, `node tests/unit/renderer/pages/GroupedHistory/userChoiceNotifications.browser.mjs` exercises the isolated desktop/tablet/phone fixture in headless Edge. It does not mutate real conversations/settings or invoke an AI. Screenshots are saved under the temporary directory. Override `AIONUI_CHOICE_FIXTURE_HOST` only if the dev server uses a different port.

The parent `run-aionui-dev-no-sentry.bat` compiles AionUi sources; no desktop package build is required. It uses AionCore's local release binaries, so an AionCore release build and the user's next app restart are needed for the prompt instruction change. Do not interrupt active conversations just to apply it.
