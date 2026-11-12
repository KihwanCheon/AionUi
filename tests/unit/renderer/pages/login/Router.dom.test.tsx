import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  status: 'unauthenticated' as 'authenticated' | 'checking' | 'unauthenticated',
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => authState,
}));
vi.mock('@renderer/pages/login', () => ({ default: () => null }));
vi.mock('@renderer/pages/conversation', () => ({ default: () => null }));
vi.mock('@renderer/pages/guid', () => ({ default: () => null }));

import PanelRoute from '@renderer/components/layout/Router';

const TestLayout: React.FC = () => <Outlet />;

const renderRouter = () => render(<PanelRoute layout={<TestLayout />} />);

describe('authenticated route return', () => {
  beforeEach(() => {
    authState.status = 'unauthenticated';
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('sends an unauthenticated protected route to login with its original location', async () => {
    window.location.hash = '#/conversation/conversation-1?panel=files';

    renderRouter();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/login?returnTo=%2Fconversation%2Fconversation-1%3Fpanel%3Dfiles');
    });
  });

  it('returns to the protected route when authentication completes', async () => {
    window.location.hash = '#/conversation/conversation-1';
    const view = renderRouter();
    await waitFor(() => {
      expect(window.location.hash).toBe('#/login?returnTo=%2Fconversation%2Fconversation-1');
    });

    authState.status = 'authenticated';
    view.rerender(<PanelRoute layout={<TestLayout />} />);

    await waitFor(() => {
      expect(window.location.hash).toBe('#/conversation/conversation-1');
    });
  });

  it('applies returnTo when an authenticated user opens the login route directly', async () => {
    authState.status = 'authenticated';
    window.location.hash = '#/login?returnTo=%2Fconversation%2Fconversation-2';

    renderRouter();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/conversation/conversation-2');
    });
  });

  it('uses the default route when returnTo is unsafe', async () => {
    authState.status = 'authenticated';
    window.location.hash = '#/login?returnTo=https%3A%2F%2Fexample.com';

    renderRouter();

    await waitFor(() => {
      expect(window.location.hash).toBe('#/guid');
    });
  });
});
