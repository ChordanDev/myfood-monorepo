// Integration test for the Profile screen failed-load retry behavior.
//
// The bug:
//   - ProfileRoute automatically called loadData() when the local load
//     status was either "idle" or "error".
//   - A failed load transitioned back to "error", so the effect retried
//     immediately without waiting for the explicit Retry button.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { act, create } from 'react-test-renderer';
import type { AuthContextValue, CurrentMe, SlotCookingTimes } from '@/features/auth/types/auth';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { ProfilePreferencesScreen } from '@/features/preferences/screens/ProfilePreferencesScreen';

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string | { pathname: string } }) => {
      const value = typeof href === 'string' ? href : href.pathname;
      return ReactMock.createElement('RedirectMock', { testID: 'redirect' }, value);
    },
  };
});

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/features/auth', () => {
  const ReactMock = require('react');
  const mockAuthContext = require('@/features/auth/context/AuthContext').AuthContext;
  return {
    useAuth: () => {
      const ctx = ReactMock.useContext(mockAuthContext);
      if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
      return ctx;
    },
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      icon: '#000',
      colorMedium: '#111',
      textBlack: '#fff',
      textLight: '#aaa',
      primaryAccent: '#ff0',
      colorBlack: '#000',
      colorDark: '#111',
    },
  }),
}));

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: ({ children }: { children: unknown }) => children,
}));

function makeMe(overrides: Partial<CurrentMe> = {}): CurrentMe {
  return {
    user: {
      id: 'user-1',
      email: 'user@example.com',
      displayName: null,
      householdSize: null,
      cookingSkill: null,
    },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: '2099-12-31T00:00:00Z',
      subscriptionStatus: 'none',
      access: { canUseApp: true, reason: null },
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
    ...overrides,
  };
}

function buildContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const me = makeMe();
  return {
    me,
    user: me.user,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    token: 'access-1',
    isLoading: false,
    isAuthenticated: true,
    canUseApp: true,
    accessReason: null,
    isTrialExpired: false,
    isComplete: true,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    refreshMe: jest.fn(),
    completeOnboarding: jest.fn(),
    fetchUserPreferences: jest.fn(),
    saveUserPreferences: jest.fn(),
    fetchSlotCookingTimes: jest.fn(),
    saveSlotCookingTimes: jest.fn(),
    updateProfile: jest.fn(),
    requestVerificationCode: jest.fn(),
    sendVerificationCode: jest.fn(),
    ...overrides,
  };
}

const slotCookingTimes: SlotCookingTimes = {
  breakfast: { cookingTimeMinutes: 10, hungerLevel: 'light' },
  lunch: { cookingTimeMinutes: 20, hungerLevel: 'normal' },
  dinner: { cookingTimeMinutes: 30, hungerLevel: 'strong' },
};

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ProfilePreferencesScreen failed-load retry behavior', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not automatically retry after an initial profile load failure', async () => {
    let preferenceCalls = 0;
    const fetchUserPreferences = jest.fn(() => {
      preferenceCalls += 1;
      if (preferenceCalls === 1) {
        return Promise.reject(new Error('load failed'));
      }
      return Promise.resolve({ diet: null, hardRestrictions: [], softPreferences: [] });
    });
    const fetchSlotCookingTimes = jest.fn(() => Promise.resolve(slotCookingTimes));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(
        React.createElement(
          AuthContext.Provider,
          {
            value: buildContext({
              fetchUserPreferences,
              fetchSlotCookingTimes,
            }),
          },
          React.createElement(ProfilePreferencesScreen)
        )
      );
    });

    await flushEffects();

    expect(fetchUserPreferences).toHaveBeenCalledTimes(1);
    expect(fetchSlotCookingTimes).toHaveBeenCalledTimes(1);

    const retryButton = tree!.root.findAll((node) => node.props.accessibilityRole === 'button')[0];
    await act(async () => {
      retryButton.props.onPress();
    });
    await flushEffects();

    expect(fetchUserPreferences).toHaveBeenCalledTimes(2);
    expect(fetchSlotCookingTimes).toHaveBeenCalledTimes(2);

    act(() => {
      tree?.unmount();
    });
  });
});
