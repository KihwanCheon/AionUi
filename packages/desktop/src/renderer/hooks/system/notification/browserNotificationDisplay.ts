import type { NotificationPayload } from './browserNotificationCore';
import { registerPwa } from '@/renderer/services/registerPwa';

/** Mobile Chrome requires the service-worker API rather than the Notification constructor. */
export async function showBrowserNotification(payload: NotificationPayload, onClick: () => void): Promise<void> {
  if (!window.isSecureContext || !('Notification' in window) || Notification.permission !== 'granted')
    throw new Error('Browser notifications are unavailable');
  if (navigator.serviceWorker && typeof navigator.serviceWorker.getRegistration === 'function') {
    let registration = await navigator.serviceWorker.getRegistration();
    registration ??= await registerPwa();
    if (registration && typeof registration.showNotification === 'function') {
      if (!registration.active) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error('Service worker activation timed out')), 5000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      await registration.showNotification('AionUi', {
        body: payload.body,
        data: { conversationId: payload.conversationId },
      });
      return;
    }
  }
  const notification = new Notification('AionUi', { body: payload.body });
  notification.onclick = () => {
    window.focus();
    onClick();
    notification.close();
  };
}
