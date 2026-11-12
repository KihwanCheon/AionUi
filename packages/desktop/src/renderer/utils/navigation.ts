/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NavigateFunction, NavigateOptions } from 'react-router-dom';

export const DEFAULT_AUTH_RETURN_TO = '/guid';

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });

const decodePathnameForValidation = (pathname: string): string | null => {
  let decoded = pathname;

  try {
    for (let pass = 0; pass < 5; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded;
      }
      decoded = next;
    }
  } catch {
    return null;
  }

  return decoded.includes('%') ? null : decoded;
};

/** Builds a login route that preserves the requested internal location. */
export const buildLoginPath = (pathname: string, search: string): string => {
  const params = new URLSearchParams({ returnTo: `${pathname}${search}` });
  return `/login?${params.toString()}`;
};

/** Resolves a safe post-login destination, falling back to the default route. */
export const resolveLoginReturnTo = (search: string): string => {
  const returnTo = new URLSearchParams(search).get('returnTo');
  if (
    !returnTo ||
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    returnTo.includes('\\') ||
    hasControlCharacter(returnTo)
  ) {
    return DEFAULT_AUTH_RETURN_TO;
  }

  const pathname = returnTo.split(/[?#]/, 1)[0];
  const decodedPathname = decodePathnameForValidation(pathname);
  if (
    !decodedPathname ||
    !decodedPathname.startsWith('/') ||
    decodedPathname.startsWith('//') ||
    decodedPathname.includes('\\') ||
    hasControlCharacter(decodedPathname)
  ) {
    return DEFAULT_AUTH_RETURN_TO;
  }

  const normalizedPathname = decodedPathname.split(/[?#]/, 1)[0].toLowerCase();
  if (normalizedPathname === '/login' || normalizedPathname.startsWith('/login/')) {
    return DEFAULT_AUTH_RETURN_TO;
  }

  return returnTo;
};

/**
 * Module-level handle to React Router's `navigate`, registered once by a
 * component mounted inside the Router (see `Layout`). This lets code that runs
 * *outside* the Router context — e.g. the globally-mounted FeedbackReportModal,
 * which lives above `<Router>` in the provider tree — trigger navigation
 * without calling `useNavigate()` during render (which would throw
 * "useNavigate() may be used only in the context of a <Router>").
 */
let navigateRef: NavigateFunction | null = null;

export const setGlobalNavigate = (navigate: NavigateFunction | null): void => {
  navigateRef = navigate;
};

/**
 * Navigate to a path from anywhere, including outside the Router tree. No-op
 * (with a console warning) if the Router hasn't mounted yet — callers treat
 * navigation as best-effort rather than a hard dependency.
 */
export const globalNavigate = (to: string, options?: NavigateOptions): void => {
  if (!navigateRef) {
    console.warn('[navigation] globalNavigate called before Router mounted; ignoring.');
    return;
  }
  navigateRef(to, options);
};
