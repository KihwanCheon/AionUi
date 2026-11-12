import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { appMock, createFromDataURLMock } = vi.hoisted(() => ({
  appMock: { badgeCount: 0 },
  createFromDataURLMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: appMock,
  nativeImage: { createFromDataURL: createFromDataURLMock },
}));

type WindowMock = {
  window: BrowserWindow;
  flashFrame: ReturnType<typeof vi.fn>;
  focus: () => void;
  setOverlayIcon: ReturnType<typeof vi.fn>;
};

function createWindow(focused = false): WindowMock {
  let focusListener = (): void => {};
  const flashFrame = vi.fn();
  const setOverlayIcon = vi.fn();
  const window = {
    flashFrame,
    isDestroyed: () => false,
    isFocused: () => focused,
    on: (event: string, listener: () => void) => {
      if (event === 'focus') focusListener = listener;
    },
    setOverlayIcon,
  } as unknown as BrowserWindow;
  return { window, flashFrame, focus: () => focusListener(), setOverlayIcon };
}

describe('taskbar badge service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    appMock.badgeCount = 0;
  });

  afterEach(async () => {
    const { stopTaskbarFlashing } = await import('@/process/services/taskbarBadge');
    stopTaskbarFlashing();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mirrors the badge count and flashes until the window gains focus', async () => {
    const { applyTaskbarBadge, setTaskbarBadgeWindow } = await import('@/process/services/taskbarBadge');
    const windowMock = createWindow();
    setTaskbarBadgeWindow(windowMock.window);

    applyTaskbarBadge(2);
    vi.advanceTimersByTime(700);

    expect(appMock.badgeCount).toBe(2);
    expect(windowMock.flashFrame).toHaveBeenCalledWith(true);

    windowMock.focus();
    expect(windowMock.flashFrame).toHaveBeenLastCalledWith(false);
    const callsAfterFocus = windowMock.flashFrame.mock.calls.length;
    vi.advanceTimersByTime(1400);
    expect(windowMock.flashFrame).toHaveBeenCalledTimes(callsAfterFocus);
  });

  it('sets a Windows overlay icon from the renderer-provided data URL', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const image = { isEmpty: () => false };
    createFromDataURLMock.mockReturnValue(image);
    const { applyTaskbarBadge, setTaskbarBadgeWindow } = await import('@/process/services/taskbarBadge');
    const windowMock = createWindow(true);
    setTaskbarBadgeWindow(windowMock.window);

    applyTaskbarBadge(3, 'data:image/png;base64,badge');

    expect(createFromDataURLMock).toHaveBeenCalledWith('data:image/png;base64,badge');
    expect(windowMock.setOverlayIcon).toHaveBeenCalledWith(image, '3 completed');
  });
});
