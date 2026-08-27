import { isStartHomeBypassEnabled, resolveTabsGate } from '../start-home-bypass';

describe('isStartHomeBypassEnabled', () => {
  it('is enabled only in development with the exact true flag', () => {
    expect(isStartHomeBypassEnabled({ isDevelopment: true, startHomeFlag: 'true' })).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1'])(
    'is disabled in development for flag value %p',
    (startHomeFlag) => {
      expect(isStartHomeBypassEnabled({ isDevelopment: true, startHomeFlag })).toBe(false);
    }
  );

  it('is disabled in production even when the public flag is true', () => {
    expect(isStartHomeBypassEnabled({ isDevelopment: false, startHomeFlag: 'true' })).toBe(false);
  });
});

describe('resolveTabsGate', () => {
  const blockedUser = {
    isAuthenticated: false,
    isLoading: false,
    canUseApp: false,
    isComplete: false,
  } as const;

  it('permits tabs when the development bypass is enabled', () => {
    expect(resolveTabsGate(blockedUser, true)).toBe('Tabs');
  });

  it('retains the index redirect when the development bypass is disabled', () => {
    expect(resolveTabsGate(blockedUser, false)).toBe('RedirectToIndex');
  });

  it('retains the loading guard when the development bypass is disabled', () => {
    expect(resolveTabsGate({ ...blockedUser, isLoading: true }, false)).toBe('Loading');
  });

  it('retains access for authenticated, complete, usable users', () => {
    expect(
      resolveTabsGate(
        {
          isAuthenticated: true,
          isLoading: false,
          canUseApp: true,
          isComplete: true,
        },
        false
      )
    ).toBe('Tabs');
  });
});
