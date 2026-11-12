/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-active-focus-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';

const desktopElectronApi = window.electronAPI;
const originalMatchMedia = window.matchMedia;

const useWebEnvironment = (touchFirst: boolean, touchMedia = '(pointer: coarse)'): void => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined, writable: true });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(
      (query: string) =>
        ({
          matches: touchFirst && query === touchMedia,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList
    ),
    writable: true,
  });
};

afterEach(() => {
  layoutState.isMobile = false;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: desktopElectronApi, writable: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia, writable: true });
});

const SendBoxHarness = ({
  active,
  onFocused,
  disabled,
  initialValue = '',
  onSend = vi.fn().mockResolvedValue(undefined),
  onAddToDraft,
  slashCommands,
}: {
  active?: boolean;
  onFocused?: () => void;
  disabled?: boolean;
  initialValue?: string;
  onSend?: (message: string) => Promise<void | false>;
  onAddToDraft?: () => void;
  slashCommands?: React.ComponentProps<typeof SendBox>['slash_commands'];
}) => {
  const [value, setValue] = useState(initialValue);
  return (
    <SendBox
      value={value}
      onChange={setValue}
      onSend={onSend}
      active={active}
      onFocused={onFocused}
      disabled={disabled}
      onAddToDraft={onAddToDraft}
      slash_commands={slashCommands}
    />
  );
};

describe('SendBox active-controlled focus', () => {
  it('shows Stop independently of loading and still accepts a draft', async () => {
    const onStop = vi.fn().mockResolvedValue(undefined);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<SendBox value='' loading={false} canStop={true} onStop={onStop} onSend={onSend} />);
    fireEvent.click(screen.getByTestId('sendbox-stop-btn'));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(
      <SendBox
        value='next message'
        loading={false}
        canStop={true}
        allowSendWhileLoading
        onStop={onStop}
        onSend={onSend}
      />
    );
    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('next message'));
  });

  it('does not offer Stop without a target even while submission is loading', () => {
    render(<SendBox value='' loading={true} canStop={false} onSend={vi.fn()} />);
    expect(screen.queryByTestId('sendbox-stop-btn')).toBeNull();
  });

  it('preserves the loading-based Stop fallback for other send box callers', () => {
    render(<SendBox value='' loading={true} onSend={vi.fn()} />);
    expect(screen.getByTestId('sendbox-stop-btn')).toBeInTheDocument();
  });

  it('keeps Enter mapped to Send while Draft box has its own icon action', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onAddToDraft = vi.fn();

    render(<SendBoxHarness initialValue='queued draft' onSend={onSend} onAddToDraft={onAddToDraft} />);
    fireEvent.click(screen.getByTestId('sendbox-add-to-draft-btn'));

    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    const textarea = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('queued draft');
  });

  it('restores the input when the parent blocks sending', async () => {
    const onSend = vi.fn().mockResolvedValue(false);

    render(<SendBoxHarness initialValue='blocked message' onSend={onSend} />);

    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('blocked message');
    await waitFor(() => expect(textarea.value).toBe('blocked message'));
  });

  it('uses the platform primary Enter shortcut for Draft box without sending', () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onAddToDraft = vi.fn();

    render(<SendBoxHarness initialValue='save this for later' onSend={onSend} onAddToDraft={onAddToDraft} />);

    const textarea = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([
    { device: 'phone', mobileLayout: true, touchMedia: '(pointer: coarse)' },
    { device: 'large tablet', mobileLayout: false, touchMedia: '(hover: none)' },
  ])('inserts a newline with Enter on a $device', async ({ mobileLayout, touchMedia }) => {
    layoutState.isMobile = mobileLayout;
    useWebEnvironment(true, touchMedia);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SendBoxHarness initialValue='first line' onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input');

    await user.click(textarea);
    await user.keyboard('{End}{Enter}second line');

    expect(textarea).toHaveValue('first line\nsecond line');
    expect(textarea).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a multiline touch draft with the button and advertises a newline key', async () => {
    useWebEnvironment(true);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<SendBoxHarness initialValue={'first line\nsecond line'} onSend={onSend} />);

    expect(screen.getByTestId('sendbox-input')).toHaveAttribute('enterkeyhint', 'enter');
    expect(screen.getByTestId('sendbox-send-btn')).toHaveAttribute('aria-label', 'Send now');
    fireEvent.click(screen.getByTestId('sendbox-send-btn'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('first line\nsecond line'));
  });

  it.each(['web', 'electron'])('keeps Enter submission in a narrow %s desktop', async (environment) => {
    layoutState.isMobile = true;
    useWebEnvironment(environment === 'electron');
    if (environment === 'electron') {
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: {}, writable: true });
    }
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<SendBoxHarness initialValue='desktop message' onSend={onSend} />);

    expect(screen.getByTestId('sendbox-input')).toHaveAttribute('enterkeyhint', 'send');
    expect(screen.getByTestId('sendbox-send-btn')).toHaveAttribute('aria-label', 'Send now · Enter');
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    });
    expect(onSend).toHaveBeenCalledWith('desktop message');
  });

  it('keeps Ctrl+Enter assigned to the draft box on touch clients', () => {
    useWebEnvironment(true);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onAddToDraft = vi.fn();
    render(<SendBoxHarness initialValue='save this draft' onSend={onSend} onAddToDraft={onAddToDraft} />);

    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(onAddToDraft).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('accepts slash menu selections before treating touch Enter as a newline', () => {
    useWebEnvironment(true);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <SendBoxHarness
        initialValue='/review'
        onSend={onSend}
        slashCommands={[{ name: 'review', description: 'Review changes', kind: 'template', source: 'acp' }]}
      />
    );
    const textarea = screen.getByTestId('sendbox-input');

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(textarea).toHaveValue('/review ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('preserves a trailing backslash when Enter is already a touch newline', async () => {
    useWebEnvironment(true);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SendBoxHarness initialValue={'first line\\'} onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input');

    await user.click(textarea);
    await user.keyboard('{End}{Enter}');

    expect(textarea).toHaveValue('first line\\\n');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter as a desktop newline', async () => {
    useWebEnvironment(false);
    const onSend = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SendBoxHarness initialValue='first line' onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input');

    await user.click(textarea);
    await user.keyboard('{End}{Shift>}{Enter}{/Shift}');

    expect(textarea).toHaveValue('first line\n');
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not submit while composing Korean (touch: %s)', (touchFirst) => {
    useWebEnvironment(touchFirst);
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<SendBoxHarness initialValue='한글' onSend={onSend} />);
    const textarea = screen.getByTestId('sendbox-input');

    fireEvent.compositionStart(textarea);
    const defaultAllowed = fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', isComposing: true });
    fireEvent.compositionEnd(textarea, { data: '글' });

    expect(defaultAllowed).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('focuses the textarea on mount when active is true (desktop)', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness active={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('keeps automatic focus on a fine-pointer WebUI desktop', async () => {
    layoutState.isMobile = false;
    useWebEnvironment(false);
    render(<SendBoxHarness active={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;

    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('focuses on mount when active is omitted (default true, preserves single-conversation behavior)', async () => {
    layoutState.isMobile = false;
    render(<SendBoxHarness />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('does NOT focus on mount when active is false', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={false} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus());
    expect(textarea).not.toHaveFocus();
  });

  it('does not force focus on mobile even when active', async () => {
    layoutState.isMobile = true;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={true} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    expect(textarea).not.toHaveFocus();
  });

  it('does not force focus on a touch-first WebUI tablet using the desktop layout', async () => {
    layoutState.isMobile = false;
    useWebEnvironment(true);
    render(<SendBoxHarness active={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;

    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(textarea).not.toHaveFocus();
  });

  it('allows a touch-first WebUI tablet to focus the input after a direct tap', async () => {
    layoutState.isMobile = false;
    useWebEnvironment(true);
    render(<SendBoxHarness active={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    fireEvent.touchStart(textarea);
    act(() => textarea.focus());

    expect(textarea).toHaveFocus();
  });

  it('calls onFocused when the textarea gains focus', () => {
    layoutState.isMobile = false;
    const onFocused = vi.fn();
    render(<SendBoxHarness active={false} onFocused={onFocused} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
    });
    expect(onFocused).toHaveBeenCalledTimes(1);
  });
});

describe('SendBox selection→focus downward effect', () => {
  it('focuses when active transitions false→true', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={false} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    expect(textarea).not.toHaveFocus();
    rerender(<SendBoxHarness active={true} />);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('focuses once textarea becomes enabled while active (warmup recovery)', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={true} disabled={true} />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    expect(textarea).not.toHaveFocus();
    rerender(<SendBoxHarness active={true} disabled={false} />);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('does not move the caret if the box is already focused when it becomes active', async () => {
    layoutState.isMobile = false;
    const { rerender } = render(<SendBoxHarness active={false} initialValue='hello world' />);
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(2, 2);
    });
    rerender(<SendBoxHarness active={true} initialValue='hello world' />);
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea.selectionStart).toBe(2);
  });

  it('never focuses while active stays false', async () => {
    layoutState.isMobile = false;
    render(
      <div>
        <button type='button'>outside</button>
        <SendBoxHarness active={false} />
      </div>
    );
    const textarea = screen.getByTestId('sendbox-input') as HTMLTextAreaElement;
    screen.getByRole('button', { name: 'outside' }).focus();
    await waitFor(() => expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus());
    expect(textarea).not.toHaveFocus();
  });
});
