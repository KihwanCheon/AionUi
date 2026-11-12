import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { errorMock, readUserFileMock, showOpenMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  readUserFileMock: vi.fn(),
  showOpenMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      readUserFile: { invoke: readUserFileMock },
      showOpen: { invoke: showOpenMock },
    },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  getBaseUrl: () => 'http://localhost',
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: errorMock,
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useAssistantBackup } from '@/renderer/hooks/assistant/useAssistantBackup';

describe('assistant backup restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports malformed JSON without attempting a restore', async () => {
    showOpenMock.mockResolvedValue(['D:/backup.json']);
    readUserFileMock.mockResolvedValue({ success: true, content: '{invalid' });
    const { result } = renderHook(() => useAssistantBackup());

    await act(async () => {
      await result.current.restoreAssistants();
    });

    expect(errorMock).toHaveBeenCalledWith('settings.assistantRestoreInvalid');
    expect(result.current.restoring).toBe(false);
  });

  it('treats an empty file selection as cancellation', async () => {
    showOpenMock.mockResolvedValue([]);
    const { result } = renderHook(() => useAssistantBackup());

    await act(async () => {
      await result.current.restoreAssistants();
    });

    expect(readUserFileMock).not.toHaveBeenCalled();
    expect(errorMock).not.toHaveBeenCalled();
  });
});
