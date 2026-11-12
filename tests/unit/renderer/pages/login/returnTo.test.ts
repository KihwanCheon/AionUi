import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTH_RETURN_TO, buildLoginPath, resolveLoginReturnTo } from '@renderer/utils/navigation';

const asLoginSearch = (returnTo: string): string => `?${new URLSearchParams({ returnTo }).toString()}`;

describe('login return target', () => {
  it('preserves the protected path and its query when building the login URL', () => {
    expect(buildLoginPath('/conversation/conversation-1', '?panel=files')).toBe(
      '/login?returnTo=%2Fconversation%2Fconversation-1%3Fpanel%3Dfiles'
    );
  });

  it('restores a valid internal path without changing its nested query encoding', () => {
    const returnTo = '/conversation/conversation-1?next=%2Fguid';

    expect(resolveLoginReturnTo(asLoginSearch(returnTo))).toBe(returnTo);
  });

  it.each([
    ['', 'missing target'],
    [asLoginSearch('https://example.com'), 'external URL'],
    [asLoginSearch('//example.com/conversation/1'), 'protocol-relative URL'],
    [asLoginSearch('/conversation/\\example.com'), 'backslash path'],
    [asLoginSearch('/conversation/%255Cexample.com'), 'encoded backslash path'],
    [asLoginSearch('/login'), 'login loop'],
    [asLoginSearch('/LOGIN/again'), 'case-insensitive login loop'],
    [asLoginSearch('/login%252Fagain'), 'encoded login loop'],
    [asLoginSearch('/login%253FreturnTo=/guid'), 'encoded login query loop'],
    [asLoginSearch('/conversation/%'), 'malformed encoding'],
    [asLoginSearch('/conversation/\u0000'), 'control character'],
  ])('falls back to the default route for an unsafe %s (%s)', (search) => {
    expect(resolveLoginReturnTo(search)).toBe(DEFAULT_AUTH_RETURN_TO);
  });
});
