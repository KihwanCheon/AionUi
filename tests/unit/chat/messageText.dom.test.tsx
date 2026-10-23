/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageText } from '@/common/chat/chatLib';
import { normalizeTextMessageContent } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import MessageText, {
  formatMessageTime,
  parseTeamContextResetNotice,
} from '@/renderer/pages/conversation/Messages/components/MessageText';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { openExternalUrl } from '@/renderer/utils/platform';
import {
  NotificationHighlightProvider,
  useNotificationHighlight,
} from '@/renderer/hooks/context/UserChoiceNotifications/NotificationHighlight';

const mnpContent = (source: Record<string, unknown>, body = '# MindNProgress 업무 전문') =>
  `[[MNP_CONVERSATION_SOURCE]]\n${JSON.stringify(source)}\n[[/MNP_CONVERSATION_SOURCE]]\n\n${body}`;

const previewMocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
}));
const localFileLinkMocks = vi.hoisted(() => ({
  payload: {
    path: '/missing/report.xlsx',
    reference: undefined as
      | {
          filePath: string;
          rawReference: string;
          line?: number;
          column?: number;
          endLine?: number;
        }
      | undefined,
  },
}));
const mockFilePreview = vi.fn(({ path }: { path: string }) => <div data-testid='file-preview'>{path}</div>);

const forkMocks = vi.hoisted(() => ({
  fork: vi.fn(),
  ensureRuntime: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));

const sessionMentionMocks = vi.hoisted(() => ({
  available: true,
  mention: vi.fn(),
}));

vi.mock('@/renderer/hooks/chat/useMentionSessionFromMessage', () => ({
  useMentionSessionFromMessage: () => ({
    available: sessionMentionMocks.available,
    pending: false,
    mention: sessionMentionMocks.mention,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getFileMetadata: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      // ChatFileRef content endpoints — useLocalFilePreview reads by Local ref.
      getContentMetadata: { invoke: vi.fn() },
      readContent: { invoke: vi.fn() },
    },
    conversation: {
      fork: { invoke: forkMocks.fork },
      ensureRuntime: { invoke: forkMocks.ensureRuntime },
    },
  },
}));

// useForkConversation needs a router context; MessageText renders without one.
vi.mock('react-router-dom', () => ({
  useNavigate: () => forkMocks.navigate,
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    openPreview: previewMocks.openPreview,
  }),
}));

vi.mock('@/renderer/components/chat/CollapsibleContent', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  __esModule: true,
  default: (props: { path: string }) => mockFilePreview(props),
}));

vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown', () => ({
  __esModule: true,
  default: ({
    children,
    onLocalFileLink,
    highlightUserQuestions,
    highlightedQuestionIndex,
    questionsComplete,
  }: {
    children?: React.ReactNode;
    highlightUserQuestions?: boolean;
    highlightedQuestionIndex?: number;
    questionsComplete?: boolean;
    onLocalFileLink?: (
      path: string,
      reference?: {
        filePath: string;
        rawReference: string;
        line?: number;
        column?: number;
        endLine?: number;
      }
    ) => void | Promise<void>;
  }) => (
    <div
      data-highlight-user-questions={highlightUserQuestions}
      data-highlighted-question-index={highlightedQuestionIndex}
      data-questions-complete={questionsComplete}
    >
      {children}
      {onLocalFileLink && (
        <button
          type='button'
          onClick={() => void onLocalFileLink(localFileLinkMocks.payload.path, localFileLinkMocks.payload.reference)}
        >
          open local file
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/renderer/utils/chat/skillSuggestParser', () => ({
  hasSkillSuggest: () => false,
  stripSkillSuggest: (content: string) => content,
}));

vi.mock('@/renderer/utils/chat/thinkTagFilter', () => ({
  hasThinkTags: () => false,
  stripThinkTags: (content: string) => content,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
  resolveAgentLogo: () => null,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/TeammateMessageAvatar', () => ({
  __esModule: true,
  default: ({ senderName }: { senderName?: string }) => <span data-testid='teammate-avatar'>{senderName}</span>,
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type='button' {...props}>
        {children}
      </button>
    ),
  });
  return {
    Alert: () => null,
    Button: ({
      children,
      shape: _shape,
      size: _size,
      type: _type,
      ...props
    }: React.ComponentProps<'button'> & {
      shape?: string;
      size?: string;
      type?: string;
    }) => (
      <button type='button' {...props}>
        {children}
      </button>
    ),
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <div onClick={() => setOpen(true)}>{children}</div>
          {open ? droplist : null}
        </div>
      );
    },
    Menu,
    Message: {
      error: vi.fn(),
    },
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
  MoreOne: () => <span data-testid='more-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; name?: string }) =>
      (options?.defaultValue ?? key).replace('{{name}}', options?.name ?? '{{name}}'),
  }),
}));

const fileMetadata = (path: string) => ({
  name: path.split(/[\\/]/).pop() || path,
  path,
  size: 128,
  type: 'file',
  lastModified: 1_717_000_000,
});

describe('MessageText attachment paths', () => {
  beforeEach(() => {
    mockFilePreview.mockClear();
    vi.mocked(copyText).mockClear();
    previewMocks.openPreview.mockClear();
    localFileLinkMocks.payload = {
      path: '/missing/report.xlsx',
      reference: undefined,
    };
    vi.mocked(ipcBridge.fs.getFileMetadata.invoke).mockReset();
    vi.mocked(ipcBridge.fs.getImageBase64.invoke).mockReset();
    vi.mocked(ipcBridge.fs.readFile.invoke).mockReset();
    // Default: file exists (metadata resolves); tests that read set readContent.
    vi.mocked(ipcBridge.fs.getContentMetadata.invoke).mockReset().mockResolvedValue(fileMetadata('/x'));
    vi.mocked(ipcBridge.fs.readContent.invoke).mockReset().mockResolvedValue('');
  });

  const renderMessageWithLocalLink = (content = '[report](/missing/report.xlsx)') => {
    const message: IMessageText = {
      id: 'msg-local-link',
      msg_id: 'msg-local-link',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      content: {
        content,
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );
  };

  const renderMessageText = (
    content: string,
    overrides: Partial<IMessageText> = {},
    contentOverrides: Partial<IMessageText['content']> = {}
  ) => {
    const message: IMessageText = {
      id: 'msg-marker',
      msg_id: 'msg-marker',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      content: {
        content,
        ...contentOverrides,
      },
      ...overrides,
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );
  };

  it('resolves relative attachment paths against the current workspace before previewing', () => {
    const message: IMessageText = {
      id: 'msg-1',
      msg_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'right',
      createdAt: Date.now(),
      content: {
        content: 'look at this\n\n[[AION_FILES]]\nuploads/photo.png',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('file-preview')).toHaveTextContent('/workspace/demo/uploads/photo.png');
  });

  it('lets text message content use the available row width on desktop', () => {
    const message: IMessageText = {
      id: 'msg-width',
      msg_id: 'msg-width',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      createdAt: Date.now(),
      content: {
        content: 'wide content',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    const content = screen.getByTestId('message-text-content');
    expect(content.parentElement?.className).toContain('min-w-0');
    expect(content.parentElement?.className).not.toContain('max-w-780px');
  });

  it('wraps a long unbroken url/path in a user message so the bubble never overflows', () => {
    const longPath = '/var/folders/gd/6bb7q8jd1ll0g17q5gly4flw0000gn/T/aionui/0265f4a8/image-xxxxxxxxxxxxxxxxxx';

    renderMessageText(longPath, { position: 'right' });

    const content = screen.getByTestId('message-text-content');
    // overflow-wrap: anywhere breaks a no-space run by character AND shrinks
    // min-content, so the bubble stays within the row. break-words does neither.
    expect(content.className).toContain('[overflow-wrap:anywhere]');
    expect(content.className).not.toContain('break-words');
    expect(content).toHaveTextContent(longPath);
  });

  it('keeps absolute attachment paths unchanged before previewing', () => {
    const message: IMessageText = {
      id: 'msg-2',
      msg_id: 'msg-2',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'right',
      createdAt: Date.now(),
      content: {
        content: 'look at this\n\n[[AION_FILES]]\n/Users/demo/Desktop/photo.png',
      },
    };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('file-preview')).toHaveTextContent('/Users/demo/Desktop/photo.png');
  });

  it('previews valid user attachment paths with Windows, relative, spaces, and Chinese filenames', () => {
    const content = [
      'look at these',
      '',
      '[[AION_FILES]]',
      'C:\\Users\\demo\\Desktop\\图片 文件.png',
      'uploads/中文 文件.txt',
      '设计 图.png',
    ].join('\n');

    renderMessageText(content, { position: 'right' });

    const previews = screen.getAllByTestId('file-preview');
    expect(previews).toHaveLength(3);
    expect(previews[0]).toHaveTextContent('C:\\Users\\demo\\Desktop\\图片 文件.png');
    expect(previews[1]).toHaveTextContent('/workspace/demo/uploads/中文 文件.txt');
    expect(previews[2]).toHaveTextContent('/workspace/demo/设计 图.png');
    expect(screen.getByTestId('message-text-content')).toHaveTextContent('look at these');
  });

  it('renders assistant marker mentions as full message text without file previews', () => {
    const content = '请不要使用 [[AION_FILES]] 这种格式';

    renderMessageText(content);

    expect(screen.getByTestId('message-text-content')).toHaveTextContent(content);
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    expect(mockFilePreview).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getFileMetadata.invoke).not.toHaveBeenCalled();
  });

  it('keeps assistant marker-tail markdown visible as message text', () => {
    const content = [
      '不是用 `[[AION_FILES]]` 路径形式。',
      '',
      '[[AION_FILES]]',
      '## 怎么解决',
      '- 路径引用...模型看不到像素',
    ].join('\n');

    renderMessageText(content);

    const messageContent = screen.getByTestId('message-text-content');
    expect(messageContent).toHaveTextContent('不是用 `[[AION_FILES]]` 路径形式。');
    expect(messageContent).toHaveTextContent('[[AION_FILES]]');
    expect(messageContent).toHaveTextContent('## 怎么解决');
    expect(messageContent).toHaveTextContent('- 路径引用...模型看不到像素');
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    expect(mockFilePreview).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getFileMetadata.invoke).not.toHaveBeenCalled();
  });

  it('keeps assistant fenced-code marker text visible without file previews', () => {
    const content = ['```md', '[[AION_FILES]]', 'uploads/photo.png', '```'].join('\n');

    renderMessageText(content);

    const messageContent = screen.getByTestId('message-text-content');
    expect(messageContent).toHaveTextContent('```md');
    expect(messageContent).toHaveTextContent('[[AION_FILES]]');
    expect(messageContent).toHaveTextContent('uploads/photo.png');
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    expect(mockFilePreview).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getFileMetadata.invoke).not.toHaveBeenCalled();
  });

  it('keeps teammate marker text visible without file previews', () => {
    const content = '请不要使用 [[AION_FILES]] 这种格式';

    renderMessageText(
      content,
      {},
      {
        teammateMessage: true,
        senderName: 'Agent A',
        senderConversationId: 'agent-a',
      }
    );

    expect(screen.getByTestId('message-text-content')).toHaveTextContent(content);
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    expect(mockFilePreview).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getFileMetadata.invoke).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'markdown heading and list',
      tailLines: ['## 怎么解决', '- 路径引用...模型看不到像素'],
    },
    {
      name: 'code fence',
      tailLines: ['```md', 'uploads/photo.png', '```'],
    },
    {
      name: 'url',
      tailLines: ['https://example.com/photo.png'],
    },
  ])('keeps invalid user marker block text visible for $name', ({ tailLines }) => {
    const content = ['look', '', '[[AION_FILES]]', ...tailLines].join('\n');

    renderMessageText(content, { position: 'right' });

    const messageContent = screen.getByTestId('message-text-content');
    expect(messageContent).toHaveTextContent('look');
    expect(messageContent).toHaveTextContent('[[AION_FILES]]');
    for (const line of tailLines) {
      expect(messageContent).toHaveTextContent(line);
    }
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument();
    expect(mockFilePreview).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getFileMetadata.invoke).not.toHaveBeenCalled();
  });

  it('copies complete assistant marker text', async () => {
    const content = '请不要使用 [[AION_FILES]] 这种格式';

    renderMessageText(content);

    const copyControl = screen.getByTestId('copy-icon').parentElement;
    expect(copyControl).not.toBeNull();
    fireEvent.click(copyControl as HTMLElement);

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(content);
    });
  });

  it('copies complete teammate marker text', async () => {
    const content = '请不要使用 [[AION_FILES]] 这种格式';

    renderMessageText(
      content,
      {},
      {
        teammateMessage: true,
        senderName: 'Agent A',
        senderConversationId: 'agent-a',
      }
    );

    const copyControl = screen.getByTestId('copy-icon').parentElement;
    expect(copyControl).not.toBeNull();
    fireEvent.click(copyControl as HTMLElement);

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(content);
    });
  });

  it('opens a missing-file preview when a local markdown link no longer exists', async () => {
    // Missing file: the content-metadata existence check rejects (backend 404).
    vi.mocked(ipcBridge.fs.getContentMetadata.invoke).mockRejectedValue(new Error('not found'));
    localFileLinkMocks.payload = {
      path: '/missing/report.xlsx',
      reference: {
        filePath: '/missing/report.xlsx',
        rawReference: '/missing/report.xlsx:10:2',
        line: 10,
        column: 2,
      },
    };

    renderMessageWithLocalLink();

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        '',
        'excel',
        expect.objectContaining({
          file_name: 'report.xlsx',
          file_path: '/missing/report.xlsx',
          missingFile: true,
          editable: false,
          targetLine: 10,
          targetColumn: 2,
        }),
        { replace: true }
      );
    });
  });

  it('opens an existing code local markdown link with read content and target location', async () => {
    const filePath = '/workspace/demo/src/app.ts';
    localFileLinkMocks.payload = {
      path: filePath,
      reference: {
        filePath,
        rawReference: `${filePath}:42:7`,
        line: 42,
        column: 7,
      },
    };
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('const value = 1;\n');

    renderMessageWithLocalLink('[app.ts](/workspace/demo/src/app.ts:42:7)');

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'const value = 1;\n',
        'code',
        expect.objectContaining({
          file_name: 'app.ts',
          fileRef: { kind: 'local', path: filePath },
          file_path: filePath,
          workspace: '/workspace/demo',
          language: 'ts',
          targetLine: 42,
          targetColumn: 7,
          oversized: false,
          lastModified: 1_717_000_000,
        }),
        { replace: true }
      );
    });
    // Content read by Local ChatFileRef over /content (utf8), not the legacy path endpoints.
    expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
      file: { kind: 'local', path: filePath },
      encoding: 'utf8',
    });
  });

  it('opens hash range local markdown links with only the start line in preview metadata', async () => {
    const filePath = '/workspace/demo/src/app.ts';
    localFileLinkMocks.payload = {
      path: filePath,
      reference: {
        filePath,
        rawReference: `${filePath}#L10-L20`,
        line: 10,
        endLine: 20,
      },
    };
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('const value = 1;\n');

    renderMessageWithLocalLink('[app.ts](/workspace/demo/src/app.ts#L10-L20)');

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'const value = 1;\n',
        'code',
        expect.objectContaining({
          file_name: 'app.ts',
          file_path: filePath,
          workspace: '/workspace/demo',
          language: 'ts',
          targetLine: 10,
          targetColumn: undefined,
          oversized: false,
          lastModified: 1_717_000_000,
        }),
        { replace: true }
      );
    });

    const metadata = previewMocks.openPreview.mock.calls[0]?.[2];
    expect(metadata).not.toHaveProperty('endLine');
    expect(metadata).not.toHaveProperty('targetEndLine');
  });

  it('opens office and pdf local markdown links without reading file content', async () => {
    const filePath = '/workspace/demo/reports/q2.pdf';
    localFileLinkMocks.payload = { path: filePath, reference: undefined };
    vi.mocked(ipcBridge.fs.getFileMetadata.invoke).mockResolvedValue(fileMetadata(filePath));

    renderMessageWithLocalLink('[q2.pdf](/workspace/demo/reports/q2.pdf)');

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        '',
        'pdf',
        expect.objectContaining({
          file_name: 'q2.pdf',
          file_path: filePath,
          workspace: '/workspace/demo',
          language: 'pdf',
        }),
        { replace: true }
      );
    });
    expect(ipcBridge.fs.readFile.invoke).not.toHaveBeenCalled();
    expect(ipcBridge.fs.getImageBase64.invoke).not.toHaveBeenCalled();
  });

  it('opens image local markdown links from base64 content without reading text content', async () => {
    const filePath = '/workspace/demo/assets/chart.png';
    localFileLinkMocks.payload = { path: filePath, reference: undefined };
    vi.mocked(ipcBridge.fs.readContent.invoke).mockResolvedValue('data:image/png;base64,abc123');

    renderMessageWithLocalLink('[chart.png](/workspace/demo/assets/chart.png)');

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        'data:image/png;base64,abc123',
        'image',
        expect.objectContaining({
          file_name: 'chart.png',
          fileRef: { kind: 'local', path: filePath },
          file_path: filePath,
          workspace: '/workspace/demo',
          language: 'png',
          editable: false,
        }),
        { replace: true }
      );
    });
    // Image read as a data URL over /content (dataurl encoding).
    expect(ipcBridge.fs.readContent.invoke).toHaveBeenCalledWith({
      file: { kind: 'local', path: filePath },
      encoding: 'dataurl',
    });
  });

  // Supersedes the old "truncated read content" case. Truncation is gone: an
  // oversized file is not read at all, because a partially read document reaching
  // a saveable editor is what destroyed the unread remainder on save.
  it('opens oversized local markdown links without reading content, read-only', async () => {
    const filePath = '/workspace/demo/logs/app.log';
    const oversize = 1024 * 1024 + 1;
    localFileLinkMocks.payload = { path: filePath, reference: undefined };
    vi.mocked(ipcBridge.fs.getContentMetadata.invoke).mockResolvedValue({
      name: 'app.log',
      path: filePath,
      size: oversize,
      type: 'file',
      lastModified: 1_717_000_000,
    });

    renderMessageWithLocalLink('[app.log](/workspace/demo/logs/app.log)');

    fireEvent.click(screen.getByRole('button', { name: 'open local file' }));

    await waitFor(() => {
      expect(previewMocks.openPreview).toHaveBeenCalledWith(
        '',
        'code',
        expect.objectContaining({
          file_name: 'app.log',
          file_path: filePath,
          oversized: true,
          sizeBytes: oversize,
          thresholdBytes: 1024 * 1024,
          editable: false,
        }),
        { replace: true }
      );
    });
    // The whole point: the content endpoint is never hit for an oversized file.
    expect(ipcBridge.fs.readContent.invoke).not.toHaveBeenCalled();
  });
});

describe('MessageText session message navigation', () => {
  beforeEach(() => {
    forkMocks.navigate.mockReset();
    sessionMentionMocks.mention.mockReset();
    sessionMentionMocks.available = true;
    vi.mocked(openExternalUrl).mockClear();
  });

  const renderSessionMessage = (content: string, position: IMessageText['position'] = 'right') =>
    render(
      <ConversationProvider value={{ conversation_id: 'recipient', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText
          showCopyRow={false}
          message={{
            id: 'received-message',
            conversation_id: 'recipient',
            type: 'text',
            position,
            content: { content },
          }}
        />
      </ConversationProvider>
    );

  const deliveryContent = (id = 'sender-123', name = 'Sender conversation', workspace = 'same') =>
    [
      '[[AION_SESSION_MESSAGE]]',
      `from: ${name}\t${id}`,
      `workspace: ${workspace}`,
      `reply_to: ${id}`,
      '[[/AION_SESSION_MESSAGE]]',
      'The delegated work is complete.',
    ].join('\n');

  it.each([
    { kind: 'delegation', conversationId: 'parent-1', name: '상위 업무 대화' },
    { kind: 'report', conversationId: 'child-1', name: '하위 업무 대화' },
  ])('opens the source of an MnP $kind without adding a draft mention', (source) => {
    renderSessionMessage(mnpContent(source));
    fireEvent.click(screen.getByRole('button', { name: `From conversation ${source.name}` }));
    expect(forkMocks.navigate).toHaveBeenCalledWith(`/conversation/${source.conversationId}`);
    expect(sessionMentionMocks.mention).not.toHaveBeenCalled();
    expect(screen.getByTestId('message-text-content')).not.toHaveTextContent('[[MNP_CONVERSATION_SOURCE]]');
  });

  it('opens a remote reporting conversation in its own WebUI', () => {
    const externalUrl = 'http://sub.example:7777/#/conversation/child-1';
    renderSessionMessage(mnpContent({ kind: 'report', conversationId: 'child-1', name: '하위 대화', externalUrl }));
    fireEvent.click(screen.getByRole('button', { name: 'From conversation 하위 대화' }));
    expect(openExternalUrl).toHaveBeenCalledWith(externalUrl);
    expect(forkMocks.navigate).not.toHaveBeenCalled();
    expect(sessionMentionMocks.mention).not.toHaveBeenCalled();
  });

  it('does not navigate locally when the remote machine address is unavailable', () => {
    renderSessionMessage(mnpContent({ kind: 'report', conversationId: 'child-1', externalUrl: null }));
    const badge = screen.getByRole('button', { name: 'From conversation child-1' });
    expect(badge).toBeDisabled();
    fireEvent.click(badge);
    expect(forkMocks.navigate).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('opens the MnP source with the %s key', async (key) => {
    const user = userEvent.setup();
    renderSessionMessage(mnpContent({ kind: 'delegation', conversationId: 'parent-1', name: '상위 대화' }));
    screen.getByRole('button', { name: 'From conversation 상위 대화' }).focus();
    await user.keyboard(key);
    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/parent-1');
    expect(sessionMentionMocks.mention).not.toHaveBeenCalled();
  });

  it('keeps the outer report source when a child quotes a session message', () => {
    renderSessionMessage(
      mnpContent({ kind: 'report', conversationId: 'child-1', name: '하위 대화' }, deliveryContent())
    );
    fireEvent.click(screen.getByRole('button', { name: 'From conversation 하위 대화' }));
    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/child-1');
    expect(screen.queryByRole('button', { name: 'From conversation Sender conversation' })).not.toBeInTheDocument();
  });

  it.each(['right', 'left'] as const)(
    'does not create a source badge for invalid or assistant-provided metadata (%s)',
    (position) => {
      const source = { kind: 'report', conversationId: position === 'right' ? '' : 'child-1' };
      renderSessionMessage(mnpContent(source), position);
      expect(screen.queryByRole('button', { name: /From conversation/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('message-text-content')).toHaveTextContent('[[MNP_CONVERSATION_SOURCE]]');
    }
  );

  it('opens the sending conversation by ID without adding a mention to the draft', () => {
    renderSessionMessage(deliveryContent());

    fireEvent.click(screen.getByRole('button', { name: 'From conversation Sender conversation' }));

    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/sender-123');
    expect(sessionMentionMocks.mention).not.toHaveBeenCalled();
  });

  it.each(['{Enter}', ' '])('opens the sending conversation with the %s key', async (key) => {
    const user = userEvent.setup();
    renderSessionMessage(deliveryContent());

    screen.getByRole('button', { name: 'From conversation Sender conversation' }).focus();
    await user.keyboard(key);

    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/sender-123');
    expect(sessionMentionMocks.mention).not.toHaveBeenCalled();
  });

  it('can open an earlier sender even when cross-session messaging is disabled', () => {
    sessionMentionMocks.available = false;
    renderSessionMessage(deliveryContent());

    fireEvent.click(screen.getByRole('button', { name: 'From conversation Sender conversation' }));

    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/sender-123');
  });

  it('uses the sender ID across workspaces and when its name is absent', () => {
    renderSessionMessage(deliveryContent('sender-456', '', '/another/workspace'));

    fireEvent.click(screen.getByRole('button', { name: 'From conversation sender-456' }));

    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/sender-456');
    expect(screen.getByText('different workspace')).toBeInTheDocument();
  });

  it('keeps a sender ID containing URL delimiters within the conversation route', () => {
    renderSessionMessage(deliveryContent('sender/part?query#fragment'));

    fireEvent.click(screen.getByRole('button', { name: 'From conversation Sender conversation' }));

    expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/sender%2Fpart%3Fquery%23fragment');
  });

  it('keeps a malformed delivery without a sender ID as ordinary text', () => {
    const content = deliveryContent('');
    renderSessionMessage(content);

    expect(screen.queryByRole('button', { name: /From conversation/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('message-text-content')).toHaveTextContent('[[AION_SESSION_MESSAGE]]');
    expect(forkMocks.navigate).not.toHaveBeenCalled();
  });

  it('preserves mention insertion for sender-side recipient chips', () => {
    renderSessionMessage(
      'Please review.\n[[AION_SESSIONS]]\nTarget conversation\tconv-target\tworkspace: same\n[[/AION_SESSIONS]]'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Mention conversation Target conversation in the message box' })
    );

    expect(sessionMentionMocks.mention).toHaveBeenCalledWith({ id: 'conv-target', name: 'Target conversation' });
    expect(forkMocks.navigate).not.toHaveBeenCalled();
  });
});

describe('MessageText structured questions', () => {
  it('tells the question renderer when the live response finishes', () => {
    const message: IMessageText = {
      id: 'live-text',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      content: { content: '마지막 줄' },
    };
    const { rerender } = render(<MessageText message={message} isStreaming />);
    expect(screen.getByTestId('message-text-content').firstChild).toHaveAttribute('data-questions-complete', 'false');
    rerender(<MessageText message={message} isStreaming={false} />);
    expect(screen.getByTestId('message-text-content').firstChild).toHaveAttribute('data-questions-complete', 'true');
  });
  const Preview = ({ messageId, markerIndex = 0 }: { messageId: string; markerIndex?: number }) => {
    const { highlight, clear } = useNotificationHighlight();
    React.useEffect(() => {
      highlight({ key: 'preview', conversationId: 'conv-1', messageId, markerIndex });
      return () => clear('preview');
    }, [messageId, markerIndex, highlight, clear]);
    return null;
  };

  it('highlights the exact structured question and clears it when preview ends', () => {
    const message: IMessageText = {
      id: 'question-1',
      msg_id: 'stream-question',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      content: { content: 'Which runtime?', user_choice: { title: 'Which runtime?', options: ['CPU', 'Vulkan'] } },
    };
    const view = (preview: boolean) => (
      <NotificationHighlightProvider>
        {preview && <Preview messageId='stream-question' />}
        <MessageText message={message} showCopyRow={false} />
        <MessageText message={{ ...message, id: 'question-2', msg_id: 'other-question' }} showCopyRow={false} />
      </NotificationHighlightProvider>
    );
    const { rerender } = render(view(true));
    const boxes = screen.getAllByRole('group', { name: 'messages.userQuestion.choice' });
    expect(boxes.map((box) => box.hasAttribute('data-notification-highlight'))).toEqual([true, false]);
    rerender(view(false));
    expect(boxes[0]).not.toHaveAttribute('data-notification-highlight');
  });

  it('passes the matching marker index to prose rendering without changing another message', () => {
    const message: IMessageText = {
      id: 'message-1',
      conversation_id: 'conv-1',
      type: 'text',
      position: 'left',
      content: { content: 'Prose question' },
    };
    render(
      <NotificationHighlightProvider>
        <Preview messageId='message-1' markerIndex={1} />
        <MessageText message={message} showCopyRow={false} />
        <MessageText message={{ ...message, conversation_id: 'conv-2' }} showCopyRow={false} />
      </NotificationHighlightProvider>
    );
    const bodies = screen.getAllByTestId('message-text-content');
    expect(bodies[0].firstChild).toHaveAttribute('data-highlighted-question-index', '1');
    expect(bodies[1].firstChild).not.toHaveAttribute('data-highlighted-question-index');
  });

  const renderQuestion = (raw: unknown, position: IMessageText['position'] = 'left') =>
    render(
      <MessageText
        showCopyRow={false}
        message={{
          id: 'question-1',
          msg_id: 'question-1',
          conversation_id: 'conv-1',
          type: 'text',
          position,
          status: 'finish',
          content: normalizeTextMessageContent(raw),
        }}
      />
    );

  it.each([{ options: undefined }, { options: null }, { options: [] }])(
    'labels a free response request with options $options',
    ({ options }) => {
      renderQuestion({ content: 'Where is the runtime?', user_choice: { title: 'Where is the runtime?', options } });

      expect(screen.getByRole('group', { name: 'messages.userQuestion.freeText' })).toHaveTextContent(
        'Where is the runtime?'
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    }
  );

  it('labels a choice request while displaying the original question and options once', () => {
    const content = 'Which runtime?\n- CPU\n- Vulkan';
    renderQuestion({ content, user_choice: { title: 'Which runtime?', options: ['CPU', 'Vulkan'] } });

    expect(screen.getByRole('group', { name: 'messages.userQuestion.choice' })).toBeInTheDocument();
    expect(screen.getByTestId('message-text-content').textContent).toContain(content);
    expect(screen.getAllByTestId('message-text-content')).toHaveLength(1);
  });

  it.each([
    { content: 'Can you share the path?' },
    { content: 'Can you share the path?', user_choice: { title: 'Question?', options: 'Invalid' } },
  ])('leaves text without valid structured metadata unchanged: %j', (content) => {
    renderQuestion(content);

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-text-content').textContent).toContain(content.content);
  });

  it('does not label user messages as assistant questions', () => {
    renderQuestion({ content: 'CPU', user_choice: { title: 'Which runtime?', options: ['CPU', 'Vulkan'] } }, 'right');

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-text-content')).toHaveTextContent('CPU');
  });

  it('enables prose question rendering for assistant text only', () => {
    renderQuestion({ content: '[[AIONUI_USER_CHOICE_REQUIRED]]\nCan you share the path?' });

    expect(screen.getByTestId('message-text-content').firstChild).toHaveAttribute(
      'data-highlight-user-questions',
      'true'
    );
  });

  it('keeps structured questions on the existing blue-card rendering path', () => {
    renderQuestion({
      content: 'Where is the runtime?',
      user_choice: { title: 'Where is the runtime?', options: null },
    });

    expect(screen.getByTestId('message-text-content').firstChild).toHaveAttribute(
      'data-highlight-user-questions',
      'false'
    );
  });
});

describe('MessageText team system notices', () => {
  it('renders a context-reset notice through i18n instead of exposing the wire payload', () => {
    const content = JSON.stringify({
      kind: 'context_reset',
      member_name: 'Writer',
      runtime_status: 'ready',
    });
    render(
      <MessageText
        message={{
          id: 'notice-1',
          msg_id: 'notice-1',
          conversation_id: 'conv-1',
          type: 'text',
          position: 'left',
          createdAt: Date.now(),
          content: {
            content,
            teammateMessage: true,
            senderName: 'team_system',
          },
        }}
      />
    );

    expect(screen.getAllByText('team.systemNotice.sender')).toHaveLength(2);
    expect(screen.getByTestId('message-text-content')).toHaveTextContent('team.systemNotice.contextResetSuccess');
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it('rejects malformed context-reset notice payloads', () => {
    expect(parseTeamContextResetNotice('{"kind":"context_reset","runtime_status":"ready"}')).toBeNull();
  });
});

describe('MessageText delivery status badge', () => {
  const statusMessage = (status?: IMessageText['status']): IMessageText => ({
    id: 'msg-status',
    msg_id: 'msg-status',
    conversation_id: 'conv-1',
    type: 'text',
    position: 'right',
    status,
    createdAt: Date.now(),
    content: {
      content: 'sent mid-turn',
    },
  });

  it('shows a pending-delivery badge on a user message the agent has not consumed yet', () => {
    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={statusMessage('pending')} />
      </ConversationProvider>
    );

    expect(screen.getByTestId('message-status-badge')).toHaveTextContent('Unread');
  });

  it('shows no badge once the agent has consumed the message', () => {
    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={statusMessage('finish')} />
      </ConversationProvider>
    );

    expect(screen.queryByTestId('message-status-badge')).not.toBeInTheDocument();
  });

  it('shows no badge for an assistant message even if status happens to be pending', () => {
    const message = { ...statusMessage('pending'), position: 'left' as const };

    render(
      <ConversationProvider value={{ conversationId: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <MessageText message={message} />
      </ConversationProvider>
    );

    expect(screen.queryByTestId('message-status-badge')).not.toBeInTheDocument();
  });
});

describe('MessageText fork entry point', () => {
  const forkMessage = (overrides: Partial<IMessageText> = {}): IMessageText => ({
    id: 'msg-fork-1',
    msg_id: 'msg-fork-1',
    conversation_id: 'conv-fork',
    type: 'text',
    position: 'left',
    createdAt: Date.now(),
    content: { content: 'assistant reply' },
    ...overrides,
  });

  const renderWithCapability = (
    capability: { at_turn: boolean } | undefined,
    props: { isLastMessage?: boolean; hasForkAnchor?: boolean; message?: Partial<IMessageText> } = {},
    mobileWidth?: number
  ) => {
    if (mobileWidth !== undefined) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: mobileWidth });
    }
    const message = (
      <MessageText
        message={forkMessage(props.message)}
        isLastMessage={props.isLastMessage}
        hasForkAnchor={props.hasForkAnchor}
      />
    );
    render(
      <ConversationProvider
        value={{ conversation_id: 'conv-fork', workspace: '/workspace/demo', type: 'acp', forkCapability: capability }}
      >
        {mobileWidth === undefined ? (
          message
        ) : (
          <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: vi.fn() }}>
            {message}
          </LayoutContext.Provider>
        )}
      </ConversationProvider>
    );
  };

  beforeEach(() => {
    forkMocks.fork.mockReset().mockResolvedValue({ id: 'conv-forked' });
    forkMocks.ensureRuntime.mockReset().mockResolvedValue(undefined);
    forkMocks.navigate.mockReset();
    vi.mocked(copyText).mockClear();
  });

  it('hides the fork button when the agent declares no capability', () => {
    renderWithCapability(undefined, { isLastMessage: true });
    expect(screen.queryByTestId('message-fork-button')).toBeNull();
  });

  it('shows the fork button on anchored mid-history messages for at_turn backends', () => {
    renderWithCapability({ at_turn: true }, { isLastMessage: false, hasForkAnchor: true });
    expect(screen.getByTestId('message-fork-button')).toBeInTheDocument();
  });

  it('hides the fork button on un-anchored legacy messages even for at_turn backends', () => {
    renderWithCapability({ at_turn: true }, { isLastMessage: false, hasForkAnchor: false });
    expect(screen.queryByTestId('message-fork-button')).toBeNull();
  });

  it('limits head-only backends to the last message', () => {
    renderWithCapability({ at_turn: false }, { isLastMessage: false });
    expect(screen.queryByTestId('message-fork-button')).toBeNull();
  });

  it('shows the fork button on the last message for head-only backends', () => {
    renderWithCapability({ at_turn: false }, { isLastMessage: true });
    expect(screen.getByTestId('message-fork-button')).toBeInTheDocument();
  });

  it('keeps copy and fork actions visible on a touch tablet', () => {
    renderWithCapability({ at_turn: true }, { isLastMessage: false, hasForkAnchor: true }, 820);

    expect(screen.getByTestId('message-tablet-copy-button')).toBeInTheDocument();
    expect(screen.getByTestId('message-fork-button')).toBeInTheDocument();
    expect(screen.queryByTestId('message-actions-menu')).toBeNull();
  });

  it('keeps the message time visible on a touch tablet', () => {
    const createdAt = new Date(2026, 0, 2, 3, 4).getTime();
    renderWithCapability(
      { at_turn: true },
      { isLastMessage: false, hasForkAnchor: true, message: { created_at: createdAt } },
      820
    );

    const timeDisplay = screen.getByTestId('message-tablet-time');
    expect(timeDisplay).toHaveTextContent(formatMessageTime(createdAt));
    expect(timeDisplay).not.toHaveClass('opacity-0');
  });

  it('offers fork from the phone action menu', async () => {
    renderWithCapability({ at_turn: true }, { isLastMessage: false, hasForkAnchor: true }, 390);

    expect(screen.queryByTestId('message-fork-button')).toBeNull();
    fireEvent.click(screen.getByTestId('message-actions-menu'));
    fireEvent.click(await screen.findByTestId('message-fork-menu-item'));

    await waitFor(() => {
      expect(forkMocks.fork).toHaveBeenCalledWith({ conversation_id: 'conv-fork', message_id: 'msg-fork-1' });
    });
  });

  it('shows the message time as noninteractive information in the phone action menu', async () => {
    const createdAt = new Date(2026, 0, 2, 3, 4).getTime();
    renderWithCapability(
      { at_turn: true },
      { isLastMessage: false, hasForkAnchor: true, message: { created_at: createdAt } },
      390
    );

    fireEvent.click(screen.getByTestId('message-actions-menu'));

    const timeDisplay = await screen.findByTestId('message-time-menu-display');
    expect(timeDisplay).toHaveTextContent(formatMessageTime(createdAt));
    expect(timeDisplay.closest('button')).toBeNull();
  });

  it('does not offer fork in the phone menu when the agent has no capability', async () => {
    renderWithCapability(undefined, { isLastMessage: true }, 390);

    fireEvent.click(screen.getByTestId('message-actions-menu'));

    fireEvent.click(await screen.findByTestId('message-copy-menu-item'));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('assistant reply'));
    expect(screen.queryByTestId('message-fork-menu-item')).toBeNull();
  });

  it('clicking fork calls the API, refreshes, navigates, and pre-warms the runtime', async () => {
    renderWithCapability({ at_turn: true }, { isLastMessage: false, hasForkAnchor: true });
    fireEvent.click(screen.getByTestId('message-fork-button'));
    await waitFor(() => {
      expect(forkMocks.fork).toHaveBeenCalledWith({ conversation_id: 'conv-fork', message_id: 'msg-fork-1' });
      expect(forkMocks.navigate).toHaveBeenCalledWith('/conversation/conv-forked');
      expect(forkMocks.ensureRuntime).toHaveBeenCalledWith({ conversation_id: 'conv-forked' });
    });
  });
});
