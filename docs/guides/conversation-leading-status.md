# Conversation identity and adjacent activity

Feature ID: `conversation-leading-status`. Preserve the behavior across repeated upstream rebases rather than preserving a particular commit or selector.

The conversation row keeps its existing provider/assistant leading mark at normal opacity while a turn is generating. The original 16px Arco spinner appears on its leading side (left in LTR layouts), rather than replacing or surrounding it. The bookmark star sits just before status with approximately 2px between their painted outlines, without changing row padding or flow widths. In expanded project/cron rows status occupies the original bookmark center and the star moves toward it from the leading gutter. Compact top-level rows use the existing bookmark/identity gap for status, avoiding clipping the star at the row edge. The bookmark stays in its new position while idle, generating, or awaiting confirmation. Collapsed rows have no bookmark and retain the status beside the centered identity. The identity stays in its existing 22px slot and the status is absolutely positioned, so the row reserves no new horizontal space and the title does not move when activity starts. Existing cron identity precedence is unchanged. Both the main and bookmarked lists share this row, including mobile/tablet layouts.

## Integration boundaries

- `GroupedHistory/components/ConversationLeadingStatus.tsx` owns decorative activity presentation only. Use the original `Spin size={16}` and existing attention icon, preserving their shape, color, stroke, and animation. The absolute status wrapper ignores pointer events; do not reduce identity opacity or apply animation to the identity.
- `ConversationRow.tsx` passes the existing leading mark as children plus the existing generation/confirmation/batch flags. No new runtime subscription, polling, state source, or AionCore change is required.
- `ConversationBookmarkButton.tsx` translates only the rendered button; its 20px flow slot remains reserved. The translation follows `statusLayout`, not generation state, and reverses in RTL. Keep the real clickable button and tooltip at the visual location, preserving click propagation isolation.
- Unpinned desktop bookmarks are revealed by row hover or `focus-visible`, not generic `focus`. Pointer pin/unpin leaves native button focus behind; that residual focus must not keep the star visible after the pointer leaves. Preserve keyboard Tab visibility without blurring the button, and keep pinned/mobile bookmarks always visible.
- Confirmation takes precedence over generation: keep the identity and display the original attention icon in the adjacent status position instead of the spinner. Batch selection suppresses both decorations. Completion-unread dots and their existing priority remain unchanged.
- Pinned identity fades on hover only when the desktop idle-row drag/pin overlay is actually available. Generating/waiting identity must not disappear on hover. Preserve idle drag-handle click isolation and normal row selection.

## For every upstream rebase

1. Check row identity resolution, status precedence, pinned hover/drag presentation, shared all/bookmarked rendering, and the 22px slot even if Git reports no conflict. Preserve these semantic connections if upstream moves the row or its status flags. Expanded indented status uses a -26px offset from the identity slot; compact/collapsed status uses -12px. Gutter bookmarks translate -15px; compact bookmarks translate -1px. RTL reverses the translations. With the existing 14px star and 16px spinner SVG geometry, their painted outlines are about 1.92px apart. If upstream changes bookmark width, SVG geometry, indentation, or row gaps, remeasure the painted gap, unchanged identity/title geometry, and absence of clipping or glyph collisions.
2. Run the focused tests below. Preserve identity plus the adjacent original spinner, not the former mutually exclusive rendering or the discarded outer-ring design.
3. Visually verify the generating spinner beside the fully opaque provider logo, confirmation precedence, and pinned hover in expanded/collapsed lists on desktop and a touch device. The DOM tests verify composition and state transitions, not final browser paint or animation geometry. Verify the approximately 2px star/status painted gap, fixed bookmark position through state transitions, unchanged identity/title geometry, no clipping at the row edge, and bookmark hit testing while generating. Check RTL as well as LTR.
4. If upstream supplies equivalent behavior, verify the same contracts before replacing the fork helper. Do not maintain duplicate activity decorations.

```powershell
bun run test tests/unit/renderer/pages/GroupedHistory/conversationLeadingStatus.dom.test.tsx tests/unit/renderer/pages/GroupedHistory/conversationBookmarkButton.dom.test.tsx tests/unit/conversation/conversationRowWaitingIcon.dom.test.tsx tests/unit/conversation/SortableConversationRow.dom.test.tsx tests/unit/renderer/conversation/ConversationRowManualUnread.dom.test.tsx tests/unit/renderer/conversation/ConversationRowCronMenu.dom.test.tsx tests/unit/renderer/layout/completionUnread.dom.test.ts
```

This renderer-only change can apply through development HMR. The parent `run-aionui-dev-no-sentry.bat` compiles the sources on the next startup; no AionCore or package build is needed.
