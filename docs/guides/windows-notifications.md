# Windows conversation notification activation

Feature ID: `windows-conversation-notification`. Keep the behavior across repeated upstream rebases rather than preserving a commit hash.

Windows notifications with a conversation ID embed `aionui://navigate?route=...` in a protocol-activated toast. Both the popup and the notification retained in Windows Notification Center use the registered AionUi protocol handler. Navigation does not depend on the lifetime of the original Electron notification or its in-process `click` callback.

The notification keeps the caller's title, translated body, icon, enabled setting, and unfocused-window gate. Title/body and XML attributes are escaped; conversation IDs are encoded as a single route segment. Notifications without a conversation ID and non-Windows notifications keep the original native-click behavior. Browser-only WebUI notifications are separate and are unchanged.

## Integration boundaries

- `process/startup/bootstrap/windowsNotification.ts` owns toast XML generation and notification-specific diagnostics. It uses the shared protocol scheme, not a second protocol registration.
- `notificationBridge.ts` adds the Windows options at notification creation and ignores the native click callback for those protocol-activated toasts. Do not deliver the same click through both `notification.clicked` and the protocol handler.
- The existing main-process deep-link relay queues activation until the renderer subscribes, including after a renderer reload. The existing `navigate` route whitelist, window restoration, and single-instance bootstrap remain the owners of navigation and activation.
- Protocol activation relies on the existing OS registration. The normal desktop startup registers the development executable plus app path, while packaged builds register the installed app. Verify both modes if upstream changes bootstrap or protocol registration. Multiple installations or development instances share an OS protocol registration; the currently registered instance is the target.

`[WindowsNotificationActivation]` records `received` and `renderer-ready` with only the conversation ID. Their timestamp difference measures waiting inside the main-process relay; it does not measure the time from the user's Windows click to protocol reception or completion of renderer navigation. Arbitrary deep-link URLs, pairing tokens, API keys, and message content are not logged.

## For every upstream rebase

1. Preserve the helper and its small notification-creation and deep-link-relay connections. Inspect changes to Electron notification options, `aionui` registration, single-instance forwarding, renderer readiness, and the conversation navigation whitelist even if Git reports no conflict.
2. Run the focused tests below. They cover valid XML with Korean/special-character text and icons, encoded conversation targets, native-click compatibility, duplicate prevention, and actual toast-to-renderer relay wiring.
3. After an AionUi restart, finish a turn while another conversation is selected and the window is unfocused. Click the popup, then test a later notification from Windows Notification Center. Verify hidden/minimized restoration and the originating conversation selection. Do not restart a desktop managing active AI tasks just to perform this check.
4. If upstream adds equivalent reliable Windows activation, verify these contracts before replacing the fork helper. Avoid maintaining two navigation paths for the same toast.

```powershell
bun run test tests/unit/process/notificationBridge.test.ts tests/unit/process/startup/bootstrap/windowsNotification.test.ts tests/unit/process/startup/bootstrap/deepLink.test.ts tests/unit/process/startup/bootstrap/protocol.test.ts tests/unit/process/startup/windowsAppUserModelId.test.ts tests/unit/renderer/useDesktopTurnNotification.dom.test.tsx
```

The parent `run-aionui-dev-no-sentry.bat` compiles the desktop sources on startup. This fix requires an AionUi restart, not an AionCore rebuild or a package build. Native Windows click behavior must still be checked manually; the mocked notification tests do not exercise the Windows shell.
