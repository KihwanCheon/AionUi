import { useProjectGitBranches } from '@/renderer/pages/conversation/GroupedHistory/hooks/useProjectGitBranches';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGitBranches: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getGitBranches: { invoke: mocks.getGitBranches },
    },
  },
}));

describe('useProjectGitBranches', () => {
  beforeEach(() => {
    mocks.getGitBranches.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not render again for unchanged polling or focus results, regardless of response order', async () => {
    vi.useFakeTimers();
    const response = [
      { workspace: '/alpha', branch: 'main' },
      { workspace: '/plain', branch: null },
    ];
    mocks.getGitBranches.mockResolvedValue(response);
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useProjectGitBranches(['/alpha', '/plain']);
    });
    await act(async () => {});
    const initial = result.current;
    const initialRenders = renders;
    mocks.getGitBranches.mockResolvedValue(response.toReversed());

    await act(async () => vi.advanceTimersByTimeAsync(15000));
    await act(async () => window.dispatchEvent(new Event('focus')));

    expect(mocks.getGitBranches).toHaveBeenCalledTimes(5);
    expect(result.current).toBe(initial);
    expect(renders).toBe(initialRenders);
  });

  it('updates a changed branch to unknown on failure and removes obsolete workspaces', async () => {
    mocks.getGitBranches.mockResolvedValue([{ workspace: '/alpha', branch: 'main' }]);
    const { result, rerender } = renderHook(({ workspaces }) => useProjectGitBranches(workspaces), {
      initialProps: { workspaces: ['/alpha'] },
    });
    await waitFor(() => expect(result.current).toEqual({ '/alpha': 'main' }));

    mocks.getGitBranches.mockRejectedValue(new Error('backend unavailable'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(result.current).toEqual({ '/alpha': null });

    rerender({ workspaces: [] });
    expect(result.current).toEqual({});
  });

  it('ignores a late response for workspaces that have already been replaced', async () => {
    let resolveOld!: (value: { workspace: string; branch: string }[]) => void;
    mocks.getGitBranches
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValue([{ workspace: '/new', branch: 'feature/new' }]);
    const { result, rerender } = renderHook(({ workspaces }) => useProjectGitBranches(workspaces), {
      initialProps: { workspaces: ['/old'] },
    });
    rerender({ workspaces: ['/new'] });
    await waitFor(() => expect(result.current).toEqual({ '/new': 'feature/new' }));

    await act(async () => resolveOld([{ workspace: '/old', branch: 'main' }]));
    expect(result.current).toEqual({ '/new': 'feature/new' });
  });

  it('deduplicates workspaces and resolves all branches with one request', async () => {
    mocks.getGitBranches.mockResolvedValue([
      { workspace: 'C:\\Git\\Alpha', branch: 'main' },
      { workspace: 'C:\\Git\\Plain', branch: null },
    ]);

    const { result } = renderHook(() => useProjectGitBranches(['C:\\Git\\Plain', 'C:\\Git\\Alpha', 'C:\\Git\\Alpha']));

    await waitFor(() => expect(result.current['C:\\Git\\Alpha']).toBe('main'));
    expect(mocks.getGitBranches).toHaveBeenCalledOnce();
    expect(mocks.getGitBranches).toHaveBeenCalledWith({
      workspaces: ['C:\\Git\\Alpha', 'C:\\Git\\Plain'],
    });
  });

  it('keeps each requested workspace unknown when the batch request fails', async () => {
    mocks.getGitBranches.mockRejectedValue(new Error('backend unavailable'));

    const { result } = renderHook(() => useProjectGitBranches(['C:\\Git\\Alpha']));

    await waitFor(() => expect(result.current).toEqual({ 'C:\\Git\\Alpha': null }));
  });

  it('refreshes all workspaces together when the window regains focus', async () => {
    mocks.getGitBranches
      .mockResolvedValueOnce([{ workspace: 'C:\\Git\\Alpha', branch: 'main' }])
      .mockResolvedValueOnce([{ workspace: 'C:\\Git\\Alpha', branch: 'feature/focus' }]);
    const { result } = renderHook(() => useProjectGitBranches(['C:\\Git\\Alpha']));
    await waitFor(() => expect(result.current['C:\\Git\\Alpha']).toBe('main'));

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(result.current['C:\\Git\\Alpha']).toBe('feature/focus'));
    expect(mocks.getGitBranches).toHaveBeenCalledTimes(2);
  });
});
