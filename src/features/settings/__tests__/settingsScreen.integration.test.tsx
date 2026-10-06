// Integration tests for the grouped settings screen (Perfil tab).
//
// The screen is mounted with a controlled AuthContext and a palette whose
// tokens all have distinct sentinel values, so reading the wrong token is
// detectable from the rendered styles.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { AuthContext } from '@/features/auth/context/AuthContext';
import type {
  AuthContextValue,
  CurrentMe,
  SlotCookingTimes,
  UserPreferences,
} from '@/features/auth/types/auth';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

// `Required` so a token added to the contract breaks this fixture at compile time.
const mockTheme: Required<RecipeThemeConfig> = {
  colorBlack: '#010101',
  colorDark: '#020202',
  colorMedium: '#030303',
  colorLight: '#040404',
  primaryAccent: '#050505',
  appBg: '#060606',
  appBgGradient: ['#070707', '#080808'],
  icon: '#090909',
  textBlack: '#0a0a0a',
  textDark: '#0b0b0b',
  textMedium: '#0c0c0c',
  textLight: '#0d0d0d',
  primaryAccentIntense: '#0e0e0e',
  alert: '#0f0f0f',
};

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement('RedirectMock', { testID: 'redirect', href }),
  };
});

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: () => null,
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
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { Text: MockText, View: MockView } = require('react-native');
  return {
    __esModule: true,
    default: { Text: MockText, View: MockView },
    Easing: { cubic: jest.fn(), inOut: jest.fn() },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

// Local-time parts, so the trial date reads the same in any timezone.
const NOW = new Date(2026, 9, 6, 12, 0);
const TRIAL_ENDS_AT = new Date(2026, 9, 12, 12, 0).toISOString();

const RAW_CODES =
  /\b(light|normal|strong|beginner|intermediate|advanced|breakfast|lunch|dinner|omnivore|vegetarian|vegan|pescatarian|peanut|tree_nut|shellfish|gluten|dairy|egg|soy|individual|family|none)\b/;

const savedPreferences: UserPreferences = {
  diet: 'vegetarian',
  hardRestrictions: ['gluten', 'peanut'],
  softPreferences: ['picante', 'comidas rápidas'],
};

const savedSlotTimes: SlotCookingTimes = {
  breakfast: { cookingTimeMinutes: 0, hungerLevel: 'light' },
  lunch: { cookingTimeMinutes: 30, hungerLevel: 'normal' },
  dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
};

function makeMe(
  overrides: { user?: Partial<CurrentMe['user']>; account?: Partial<CurrentMe['account']> } = {}
): CurrentMe {
  return {
    user: {
      id: 'user-1',
      email: 'lucca@correo.com',
      displayName: 'Lucca Giordana',
      householdSize: 2,
      cookingSkill: 'intermediate',
      ...overrides.user,
    },
    account: {
      id: 'account-1',
      type: 'individual',
      trialEndsAt: TRIAL_ENDS_AT,
      subscriptionStatus: 'none',
      access: { canUseApp: true, reason: null },
      ...overrides.account,
    },
    membership: { role: 'owner' },
    onboarding: { isComplete: true },
  };
}

function buildContext(me: CurrentMe, overrides: Partial<AuthContextValue>): AuthContextValue {
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
    signOut: jest.fn(() => Promise.resolve()),
    refreshMe: jest.fn(),
    completeOnboarding: jest.fn(),
    fetchUserPreferences: jest.fn(() => Promise.resolve(savedPreferences)),
    saveUserPreferences: jest.fn(),
    fetchSlotCookingTimes: jest.fn(() => Promise.resolve(savedSlotTimes)),
    saveSlotCookingTimes: jest.fn(),
    updateProfile: jest.fn(),
    requestVerificationCode: jest.fn(),
    sendVerificationCode: jest.fn(),
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface RenderOptions {
  me?: CurrentMe;
  context?: Partial<AuthContextValue>;
}

async function renderScreen({ me = makeMe(), context = {} }: RenderOptions = {}) {
  const value = buildContext(me, context);
  let tree: ReturnType<typeof create> | null = null;

  await act(async () => {
    tree = create(
      <AuthContext.Provider value={value}>
        <SettingsScreen />
      </AuthContext.Provider>
    );
  });
  await flushEffects();

  return { root: tree!.root, context: value };
}

function flattenText(children: unknown): string {
  if (Array.isArray(children)) return children.map(flattenText).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

function getTexts(node: ReactTestInstance): string[] {
  return node.findAllByType(Text).map((text) => flattenText(text.props.children));
}

function findText(root: ReactTestInstance, content: string): ReactTestInstance {
  const match = root
    .findAllByType(Text)
    .find((text) => flattenText(text.props.children) === content);
  if (!match) throw new Error(`No text "${content}"`);
  return match;
}

function colorOf(node: ReactTestInstance): unknown {
  return StyleSheet.flatten(node.props.style).color;
}

// Host nodes only: the composite wrappers repeat the same testID prop.
function queryHost(root: ReactTestInstance, testID: string): ReactTestInstance | null {
  return (
    root.findAll((node) => typeof node.type === 'string' && node.props.testID === testID)[0] ?? null
  );
}

function getHost(root: ReactTestInstance, testID: string): ReactTestInstance {
  const host = queryHost(root, testID);
  if (!host) throw new Error(`No element with testID "${testID}"`);
  return host;
}

function queryButton(root: ReactTestInstance, testID: string): ReactTestInstance | null {
  return (
    root.findAll(
      (node) =>
        node.props.testID === testID &&
        node.props.accessibilityRole === 'button' &&
        typeof node.props.onPress === 'function'
    )[0] ?? null
  );
}

function getButton(root: ReactTestInstance, testID: string): ReactTestInstance {
  const button = queryButton(root, testID);
  if (!button) throw new Error(`No button with testID "${testID}"`);
  return button;
}

async function press(root: ReactTestInstance, testID: string) {
  const button = getButton(root, testID);
  await act(async () => {
    button.props.onPress();
  });
  await flushEffects();
}

function rowLabel(root: ReactTestInstance, testID: string): string {
  return getHost(root, testID).props.accessibilityLabel;
}

describe('SettingsScreen', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Only the clock is faked: the screen reads "now" for the trial state.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  describe('account card', () => {
    it('shows the initials, name, email and trial pill from me', async () => {
      const { root } = await renderScreen();

      expect(getTexts(root)).toContain('AJUSTES');
      const card = getHost(root, 'settings-account-card');
      expect(getTexts(card)).toEqual([
        'LG',
        'Lucca Giordana',
        'lucca@correo.com',
        'Prueba · 6 días',
      ]);
    });

    it('hides the trial pill when the account is not in trial', async () => {
      const { root } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'active' } }),
      });

      expect(queryHost(root, 'settings-account-trial-pill')).toBeNull();
      expect(getTexts(getHost(root, 'settings-account-card'))).toEqual([
        'LG',
        'Lucca Giordana',
        'lucca@correo.com',
      ]);
    });

    it('uses the email as the primary line when there is no display name', async () => {
      const { root } = await renderScreen({ me: makeMe({ user: { displayName: null } }) });

      expect(getTexts(getHost(root, 'settings-account-card'))).toEqual([
        'L',
        'lucca@correo.com',
        'Prueba · 6 días',
      ]);
    });

    it('paints the card with the dark-surface tokens', async () => {
      const { root } = await renderScreen();

      const card = StyleSheet.flatten(getHost(root, 'settings-account-card').props.style);
      expect(card.backgroundColor).toBe(mockTheme.colorDark);
      const avatar = StyleSheet.flatten(getHost(root, 'settings-account-avatar').props.style);
      expect(avatar.backgroundColor).toBe(withOpacity(mockTheme.icon, 0.15));
      expect(avatar.borderColor).toBe(withOpacity(mockTheme.icon, 0.3));
      const pill = StyleSheet.flatten(getHost(root, 'settings-account-trial-pill').props.style);
      expect(pill.backgroundColor).toBe(withOpacity(mockTheme.primaryAccent, 0.15));
      expect(pill.borderColor).toBe(withOpacity(mockTheme.primaryAccent, 0.3));

      expect(colorOf(findText(root, 'LG'))).toBe(mockTheme.primaryAccent);
      expect(colorOf(findText(root, 'Lucca Giordana'))).toBe(mockTheme.textLight);
      expect(colorOf(findText(root, 'lucca@correo.com'))).toBe(mockTheme.textMedium);
      expect(colorOf(findText(root, 'Prueba · 6 días'))).toBe(mockTheme.primaryAccent);
    });
  });

  describe('groups', () => {
    it('lists every row with its Spanish label and formatted value', async () => {
      const { root } = await renderScreen();

      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['Tu hogar', 'Preferencias', 'Tiempos por comida', 'Cuenta'])
      );
      expect(rowLabel(root, 'settings-row-display-name')).toBe(
        'Nombre para mostrar, Lucca Giordana'
      );
      expect(rowLabel(root, 'settings-row-household-size')).toBe('Personas en casa, 2 comensales');
      expect(rowLabel(root, 'settings-row-cooking-skill')).toBe(
        'Experiencia cocinando, Me defiendo'
      );
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegetariano');
      expect(rowLabel(root, 'settings-row-hard-restrictions')).toBe(
        'Restricciones duras, Gluten, Maní'
      );
      expect(rowLabel(root, 'settings-row-soft-preferences')).toBe(
        'Preferencias suaves, picante, comidas rápidas'
      );
      expect(rowLabel(root, 'settings-row-slot-breakfast')).toBe('Desayuno, No cocino · Liviano');
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, 30 min · Normal');
      expect(rowLabel(root, 'settings-row-slot-dinner')).toBe('Cena, 45 min · Abundante');
      expect(rowLabel(root, 'settings-row-plan')).toBe('Plan, Individual · prueba hasta 12 Oct');
    });

    it('renders the value next to the label inside each row', async () => {
      const { root } = await renderScreen();

      expect(getTexts(getHost(root, 'settings-row-slot-dinner'))).toEqual([
        'Cena',
        '45 min · Abundante',
      ]);
    });

    it('never prints a raw backend code', async () => {
      const { root } = await renderScreen();

      for (const text of getTexts(root)) {
        expect(text).not.toMatch(RAW_CODES);
      }
    });

    it('shows a placeholder for profile fields the backend did not send', async () => {
      const { root } = await renderScreen({
        me: makeMe({ user: { displayName: null, householdSize: null, cookingSkill: null } }),
      });

      expect(rowLabel(root, 'settings-row-display-name')).toBe('Nombre para mostrar, Sin definir');
      expect(rowLabel(root, 'settings-row-household-size')).toBe('Personas en casa, Sin definir');
      expect(rowLabel(root, 'settings-row-cooking-skill')).toBe(
        'Experiencia cocinando, Sin definir'
      );
    });

    it('paints the groups with the light-surface tokens', async () => {
      const { root } = await renderScreen();

      const group = StyleSheet.flatten(getHost(root, 'settings-group-household').props.style);
      expect(group.backgroundColor).toBe(mockTheme.colorLight);
      expect(colorOf(findText(root, 'Tu hogar'))).toBe(withOpacity(mockTheme.textDark, 0.6));
      expect(colorOf(findText(root, 'Dieta'))).toBe(mockTheme.textDark);
      expect(colorOf(findText(root, 'Vegetariano'))).toBe(withOpacity(mockTheme.textDark, 0.6));
    });

    it('keeps the plan row read-only', async () => {
      const { root } = await renderScreen();

      expect(queryButton(root, 'settings-row-plan')).toBeNull();
      expect(getHost(root, 'settings-row-plan').props.accessibilityRole).toBeUndefined();
    });
  });

  describe('sign out', () => {
    it('signs out from the account group', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-sign-out');

      expect(context.signOut).toHaveBeenCalledTimes(1);
    });

    it('labels sign out with the alert token and no value', async () => {
      const { root } = await renderScreen();

      expect(getTexts(getHost(root, 'settings-row-sign-out'))).toEqual(['Cerrar sesión']);
      expect(colorOf(findText(root, 'Cerrar sesión'))).toBe(mockTheme.alert);
    });
  });

  describe('loading preferences and slot times', () => {
    it('renders the account from me while the rest is still loading', async () => {
      const { root } = await renderScreen({
        context: {
          fetchUserPreferences: jest.fn(() => new Promise<UserPreferences>(() => {})),
        },
      });

      expect(getTexts(getHost(root, 'settings-account-card'))).toContain('Lucca Giordana');
      expect(rowLabel(root, 'settings-row-plan')).toBe('Plan, Individual · prueba hasta 12 Oct');
      expect(rowLabel(root, 'settings-row-display-name')).toBe(
        'Nombre para mostrar, Lucca Giordana'
      );
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Cargando…');
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, Cargando…');
      expect(queryHost(root, 'settings-load-retry')).toBeNull();
    });

    it('does not retry a failed load on its own and offers a retry', async () => {
      const fetchUserPreferences = jest
        .fn<Promise<UserPreferences>, []>()
        .mockRejectedValueOnce(new Error('load failed'))
        .mockResolvedValue(savedPreferences);
      const fetchSlotCookingTimes = jest.fn(() => Promise.resolve(savedSlotTimes));

      const { root } = await renderScreen({
        context: { fetchUserPreferences, fetchSlotCookingTimes },
      });

      expect(fetchUserPreferences).toHaveBeenCalledTimes(1);
      expect(fetchSlotCookingTimes).toHaveBeenCalledTimes(1);
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, No disponible');
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, No disponible');
      expect(getTexts(getHost(root, 'settings-account-card'))).toContain('Lucca Giordana');

      await press(root, 'settings-load-retry');

      expect(fetchUserPreferences).toHaveBeenCalledTimes(2);
      expect(fetchSlotCookingTimes).toHaveBeenCalledTimes(2);
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegetariano');
      expect(queryHost(root, 'settings-load-retry')).toBeNull();
    });
  });

  describe('access gate', () => {
    it('redirects to the index when there is no usable session', async () => {
      const { root } = await renderScreen({ context: { isAuthenticated: false } });

      expect(getHost(root, 'redirect').props.href).toBe('/');
      expect(queryHost(root, 'settings-account-card')).toBeNull();
    });
  });
});
