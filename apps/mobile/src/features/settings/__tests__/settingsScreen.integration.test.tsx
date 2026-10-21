// Integration tests for the grouped settings screen (Perfil tab).
//
// The screen is mounted with a controlled AuthContext and a palette whose
// tokens all have distinct sentinel values, so reading the wrong token is
// detectable from the rendered styles.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { loadReactNative } from '@/testing/loadReactNative';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { useBillingStore } from '@/features/billing/store/useBillingStore';
import RevenueCatUI from 'react-native-purchases-ui';
import { fixtureCurrentMe } from '@/features/auth/fixtures/currentMe';
import type {
  AccountBudget,
  AuthContextValue,
  CurrentMe,
  ProfileUpdatePayload,
  SlotCookingTimes,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import {
  fixtureInvalidDietError,
  fixturePreferences,
} from '@/features/preferences/fixtures/preferences';
import {
  fixtureSlotCookingTimes,
  fixtureSlotCookingTimesNotFoundError,
  fixtureValidationDinnerMinutesApiError,
} from '@/features/preferences/fixtures/slotCookingTimes';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import { SettingsScreen } from '../screens/SettingsScreen';

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

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement('RedirectMock', { testID: 'redirect', href }),
    useRouter: () => ({ push: mockPush }),
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

// The Account's weekly Budget is read and saved straight through the account API, not
// through AuthContext. Every test starts from the tier default; a test overrides it.
const mockFetchAccountBudget = jest.fn();
const mockUpdateAccountBudget = jest.fn();

jest.mock('@/features/account/api/accountApi', () => ({
  fetchAccountBudget: () => mockFetchAccountBudget(),
  updateAccountBudget: (payload: unknown) => mockUpdateAccountBudget(payload),
}));

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
    Easing: {
      cubic: jest.fn(),
      inOut: jest.fn(),
      // `@/components` also loads SegmentedSwitcher, which builds its easing at module scope.
      out: (curve: unknown) => curve,
      quad: 'quad',
    },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

// The window the screen is measured in: the one Jest gives by default. A test swaps it for a
// small phone, where the responsive title metrics are at their smallest.
const mockDefaultWindow = { width: 750, height: 1334, scale: 2, fontScale: 2 };
let mockWindow = mockDefaultWindow;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// Local-time parts, so the trial date reads the same in any timezone.
const NOW = new Date(2026, 9, 6, 12, 0);
const TRIAL_ENDS_AT = new Date(2026, 9, 12, 12, 0).toISOString();

const RAW_CODES =
  /\b(light|normal|strong|beginner|intermediate|advanced|breakfast|lunch|dinner|omnivore|vegetarian|vegan|pescatarian|peanut|tree_nut|shellfish|gluten|dairy|egg|soy|individual|family|none)\b/;

// What the api answers for this User: the frozen bodies its controller tests pin.
const savedPreferences: UserPreferences = fixturePreferences();

const savedSlotTimes: SlotCookingTimes = fixtureSlotCookingTimes();

// What `GET /api/account/budget` answers for an Account that never set its Budget.
const defaultBudget: AccountBudget = {
  weeklyBudgetCents: 4500000,
  isDefault: true,
  minWeeklyBudgetCents: 3000000,
  currency: 'ARS',
};

// The frozen `GET /api/me` body. The trial date is the only field replaced by default: it
// is relative to the clock these tests fake.
function makeMe(
  overrides: { user?: Partial<CurrentMe['user']>; account?: Partial<CurrentMe['account']> } = {}
): CurrentMe {
  const me = fixtureCurrentMe();

  return {
    ...me,
    user: { ...me.user, ...overrides.user },
    account: { ...me.account, trialEndsAt: TRIAL_ENDS_AT, ...overrides.account },
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
    signInWithSocial: jest.fn(),
    signOut: jest.fn(() => Promise.resolve()),
    refreshMe: jest.fn(),
    completeOnboarding: jest.fn(),
    fetchUserPreferences: jest.fn(() => Promise.resolve(savedPreferences)),
    saveUserPreferences: jest.fn((payload: UserPreferencesPayload) => Promise.resolve(payload)),
    fetchSlotCookingTimes: jest.fn(() => Promise.resolve(savedSlotTimes)),
    saveSlotCookingTimes: jest.fn((payload: SlotCookingTimesPayload) => Promise.resolve(payload)),
    updateProfile: jest.fn(),
    requestVerificationCode: jest.fn(),
    sendVerificationCode: jest.fn(),
    ...overrides,
  };
}

function createMeStore(initial: CurrentMe) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next: CurrentMe) => {
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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
  const meStore = createMeStore(me);
  const value = buildContext(me, {
    // Like the real provider: a saved profile is reflected on `me`.
    updateProfile: jest.fn(async (payload: ProfileUpdatePayload) => {
      const user = { ...meStore.get().user, ...payload };
      meStore.set({ ...meStore.get(), user });
      return { user };
    }),
    ...context,
  });

  function Harness() {
    const currentMe = React.useSyncExternalStore(meStore.subscribe, meStore.get);
    return (
      <AuthContext.Provider value={{ ...value, me: currentMe, user: currentMe.user }}>
        <SettingsScreen />
      </AuthContext.Provider>
    );
  }

  let tree: ReturnType<typeof create> | null = null;
  await act(async () => {
    tree = create(<Harness />);
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

function getInput(root: ReactTestInstance, testID: string): ReactTestInstance {
  const input = root.findAll(
    (node) => node.props.testID === testID && typeof node.props.onChangeText === 'function'
  )[0];
  if (!input) throw new Error(`No input with testID "${testID}"`);
  return input;
}

async function typeInto(root: ReactTestInstance, testID: string, text: string) {
  const input = getInput(root, testID);
  await act(async () => {
    input.props.onChangeText(text);
  });
}

function isSheetOpen(root: ReactTestInstance): boolean {
  return queryHost(root, 'settings-sheet') !== null;
}

function chipIsSelected(root: ReactTestInstance, testID: string): boolean {
  return getButton(root, testID).props.accessibilityState.selected;
}

function expectNoRawCodes(node: ReactTestInstance) {
  for (const text of getTexts(node)) {
    expect(text).not.toMatch(RAW_CODES);
  }
}

describe('SettingsScreen', () => {
  let warnSpy: jest.SpyInstance;

  beforeAll(loadReactNative, 30_000);

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
    mockFetchAccountBudget.mockReset().mockResolvedValue({ budget: defaultBudget });
    mockUpdateAccountBudget
      .mockReset()
      .mockImplementation(async ({ weeklyBudgetCents }: { weeklyBudgetCents: number }) => ({
        budget: { ...defaultBudget, weeklyBudgetCents, isDefault: false },
      }));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
    mockWindow = mockDefaultWindow;
  });

  describe('title', () => {
    // The size of "COMPRAS", the title of the shopping screen.
    const SHOPPING_TITLE_FONT_SIZE = 28;

    it('is written at the size of the shopping title, in the title ink of the palette', async () => {
      const { root } = await renderScreen();
      const title = findText(root, 'AJUSTES');

      expect(StyleSheet.flatten(title.props.style)).toEqual(
        expect.objectContaining({
          fontFamily: 'Montserrat_700Bold',
          fontSize: SHOPPING_TITLE_FONT_SIZE,
        })
      );
      expect(colorOf(title)).toBe(mockTheme.textDark);
    });

    it('keeps that size on a small phone', async () => {
      mockWindow = { width: 320, height: 568, scale: 2, fontScale: 1 };

      const { root } = await renderScreen();

      expect(StyleSheet.flatten(findText(root, 'AJUSTES').props.style).fontSize).toBe(
        SHOPPING_TITLE_FONT_SIZE
      );
    });
  });

  describe('account card', () => {
    it('shows the initials, name, email and trial pill from me', async () => {
      const { root } = await renderScreen();

      expect(getTexts(root)).toContain('AJUSTES');
      const card = getHost(root, 'settings-account-card');
      expect(getTexts(card)).toEqual([
        'LG',
        'Lucca Giordana',
        'lucca@example.com',
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
        'lucca@example.com',
      ]);
    });

    it('uses the email as the primary line when there is no display name', async () => {
      const { root } = await renderScreen({ me: makeMe({ user: { displayName: null } }) });

      expect(getTexts(getHost(root, 'settings-account-card'))).toEqual([
        'L',
        'lucca@example.com',
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
      expect(colorOf(findText(root, 'lucca@example.com'))).toBe(mockTheme.textMedium);
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
        'Restricciones duras, Maní, Gluten'
      );
      expect(rowLabel(root, 'settings-row-soft-preferences')).toBe(
        'Preferencias suaves, spicy food, quick meals'
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

  describe('favorites', () => {
    it('opens the favorites list from the account group', async () => {
      const { root } = await renderScreen();

      await press(root, 'settings-row-favorites');

      expect(mockPush).toHaveBeenCalledWith('/favorites');
    });
  });

  describe('subscription', () => {
    const originalKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;

    beforeEach(() => {
      process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = 'test_placeholder_key';
      useBillingStore.getState().reset();
      jest.mocked(RevenueCatUI.presentCustomerCenter).mockClear();
    });

    afterEach(() => {
      process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = originalKey;
      useBillingStore.getState().reset();
    });

    it('hides "Gestionar suscripción" while the Account has no active subscription', async () => {
      const { root } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'none' } }),
      });

      expect(queryHost(root, 'settings-row-manage-subscription')).toBeNull();
    });

    it('hides it in a build without a RevenueCat key', async () => {
      delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
      const { root } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'active' } }),
      });

      expect(queryHost(root, 'settings-row-manage-subscription')).toBeNull();
    });

    it('shows it when RevenueCat reports the Pro entitlement before the server does', async () => {
      useBillingStore.getState().setIdentity('rc-issued-id', true);
      const { root } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'none' } }),
      });

      expect(rowLabel(root, 'settings-row-manage-subscription')).toBe('Gestionar suscripción');
    });

    it('opens the Customer Center for a subscribed Account, then refreshes /me', async () => {
      useBillingStore.getState().setIdentity('rc-issued-id', false);
      const { root, context } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'active' } }),
      });

      await press(root, 'settings-row-manage-subscription');

      expect(RevenueCatUI.presentCustomerCenter).toHaveBeenCalledTimes(1);
      expect(context.refreshMe).toHaveBeenCalledTimes(1);
    });

    it('does not report a failure when only the /me refresh after it fails', async () => {
      useBillingStore.getState().setIdentity('rc-issued-id', false);
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const { root } = await renderScreen({
        me: makeMe({ account: { subscriptionStatus: 'active' } }),
        context: { refreshMe: jest.fn(() => Promise.reject(new Error('offline'))) },
      });

      await press(root, 'settings-row-manage-subscription');

      expect(RevenueCatUI.presentCustomerCenter).toHaveBeenCalledTimes(1);
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
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

    const noneSaved = fixtureSlotCookingTimesNotFoundError;

    it('starts from the default slot times when the user never saved any', async () => {
      const { root } = await renderScreen({
        context: { fetchSlotCookingTimes: jest.fn(() => Promise.reject(noneSaved())) },
      });

      expect(rowLabel(root, 'settings-row-slot-breakfast')).toBe('Desayuno, No cocino · Normal');
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, No cocino · Normal');
      expect(rowLabel(root, 'settings-row-slot-dinner')).toBe('Cena, No cocino · Normal');
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegetariano');
      expect(queryHost(root, 'settings-load-retry')).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('saves the three slots after starting from the defaults', async () => {
      const { root, context } = await renderScreen({
        context: { fetchSlotCookingTimes: jest.fn(() => Promise.reject(noneSaved())) },
      });

      await press(root, 'settings-row-slot-lunch');
      await press(root, 'settings-chip-minutes-30');
      await press(root, 'settings-chip-hunger-strong');
      await press(root, 'settings-sheet-save');

      expect(context.saveSlotCookingTimes).toHaveBeenCalledTimes(1);
      expect(context.saveSlotCookingTimes).toHaveBeenCalledWith({
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 30, hungerLevel: 'strong' },
        dinner: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
      });
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, 30 min · Abundante');
      expect(rowLabel(root, 'settings-row-slot-breakfast')).toBe('Desayuno, No cocino · Normal');
    });

    it.each([
      ['a 404 with another code', new ApiError('not_found', 'not found', 404)],
      ['a network error', new ApiError('network_error', 'offline')],
      ['an error that is not an api error', new Error('slot_cooking_times_not_found')],
    ])('keeps the error state when the slot times fail with %s', async (_name, error) => {
      const { root } = await renderScreen({
        context: { fetchSlotCookingTimes: jest.fn(() => Promise.reject(error)) },
      });

      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, No disponible');
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, No disponible');
      expect(queryHost(root, 'settings-load-retry')).not.toBeNull();
    });

    it('keeps the error state when the preferences fail and no slot times are saved', async () => {
      const { root } = await renderScreen({
        context: {
          fetchUserPreferences: jest.fn(() => Promise.reject(new Error('load failed'))),
          fetchSlotCookingTimes: jest.fn(() => Promise.reject(noneSaved())),
        },
      });

      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, No disponible');
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, No disponible');
      expect(queryHost(root, 'settings-load-retry')).not.toBeNull();
    });
  });

  describe('access gate', () => {
    it('redirects to the index when there is no usable session', async () => {
      const { root } = await renderScreen({ context: { isAuthenticated: false } });

      expect(getHost(root, 'redirect').props.href).toBe('/');
      expect(queryHost(root, 'settings-account-card')).toBeNull();
    });
  });

  describe('editing the profile', () => {
    it('saves the name with the full profile payload and updates the row', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-display-name');

      const sheet = getHost(root, 'settings-sheet');
      expect(getTexts(sheet)).toContain('Nombre para mostrar');
      expect(getInput(root, 'settings-input-display-name').props.value).toBe('Lucca Giordana');
      expect(getInput(root, 'settings-input-display-name').props.maxLength).toBe(60);
      // Every other field is known, so only the name is asked for.
      expect(queryHost(root, 'settings-stepper-value')).toBeNull();
      expect(queryButton(root, 'settings-chip-cooking-skill-advanced')).toBeNull();

      await typeInto(root, 'settings-input-display-name', '  Lucca  ');
      await press(root, 'settings-sheet-save');

      expect(context.updateProfile).toHaveBeenCalledTimes(1);
      expect(context.updateProfile).toHaveBeenCalledWith({
        displayName: 'Lucca',
        householdSize: 2,
        cookingSkill: 'intermediate',
      });
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-display-name')).toBe('Nombre para mostrar, Lucca');
      expect(getTexts(getHost(root, 'settings-account-card'))).toEqual(
        expect.arrayContaining(['L', 'Lucca'])
      );
    });

    it('also asks for the fields the backend did not send, so the payload is complete', async () => {
      const { root, context } = await renderScreen({
        me: makeMe({ user: { householdSize: null, cookingSkill: null } }),
      });

      await press(root, 'settings-row-display-name');

      expect(queryHost(root, 'settings-missing-fields-note')).not.toBeNull();
      expect(getTexts(getHost(root, 'settings-sheet'))).toEqual(
        expect.arrayContaining(['Personas en casa', 'Experiencia cocinando'])
      );
      expect(getHost(root, 'settings-stepper-value').props.children).toBe('Sin definir');

      // Saving with the gaps still open points at the first one and sends nothing.
      await press(root, 'settings-sheet-save');
      expect(context.updateProfile).not.toHaveBeenCalled();
      expect(getHost(root, 'settings-field-error-household-size').props.children).toBe(
        'Indicá cuántas personas son en casa, de 1 a 20.'
      );

      await press(root, 'settings-stepper-increment');
      await press(root, 'settings-stepper-increment');
      expect(getHost(root, 'settings-stepper-value').props.children).toBe('2 comensales');
      expect(queryHost(root, 'settings-field-error-household-size')).toBeNull();

      await press(root, 'settings-sheet-save');
      expect(context.updateProfile).not.toHaveBeenCalled();
      expect(getHost(root, 'settings-field-error-cooking-skill').props.children).toBe(
        'Elegí tu experiencia cocinando.'
      );

      await press(root, 'settings-chip-cooking-skill-advanced');
      await press(root, 'settings-sheet-save');

      expect(context.updateProfile).toHaveBeenCalledWith({
        displayName: 'Lucca Giordana',
        householdSize: 2,
        cookingSkill: 'advanced',
      });
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-household-size')).toBe('Personas en casa, 2 comensales');
      expect(rowLabel(root, 'settings-row-cooking-skill')).toBe(
        'Experiencia cocinando, Cocino seguido'
      );
    });

    it('edits the household size with a stepper that stays between 1 and 20', async () => {
      const { root, context } = await renderScreen({
        me: makeMe({ user: { householdSize: 19 } }),
      });

      await press(root, 'settings-row-household-size');
      expect(getTexts(getHost(root, 'settings-sheet'))).toContain('Personas en casa');
      // Only the row's own field: the name and the skill are already known.
      expect(queryHost(root, 'settings-missing-fields-note')).toBeNull();
      expect(queryHost(root, 'settings-input-display-name')).toBeNull();

      await press(root, 'settings-stepper-increment');
      expect(getHost(root, 'settings-stepper-value').props.children).toBe('20 comensales');
      expect(getButton(root, 'settings-stepper-increment').props.disabled).toBe(true);

      await press(root, 'settings-stepper-decrement');
      await press(root, 'settings-stepper-decrement');
      await press(root, 'settings-sheet-save');

      expect(context.updateProfile).toHaveBeenCalledWith({
        displayName: 'Lucca Giordana',
        householdSize: 18,
        cookingSkill: 'intermediate',
      });
      expect(rowLabel(root, 'settings-row-household-size')).toBe('Personas en casa, 18 comensales');
    });

    it('cannot step below one person', async () => {
      const { root } = await renderScreen({ me: makeMe({ user: { householdSize: 1 } }) });

      await press(root, 'settings-row-household-size');

      expect(getHost(root, 'settings-stepper-value').props.children).toBe('1 comensal');
      expect(getButton(root, 'settings-stepper-decrement').props.disabled).toBe(true);
    });

    it('edits the cooking skill with chips labelled in Spanish', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-cooking-skill');

      const sheet = getHost(root, 'settings-sheet');
      expect(getTexts(sheet)).toEqual(
        expect.arrayContaining(['Estoy arrancando', 'Me defiendo', 'Cocino seguido'])
      );
      expectNoRawCodes(sheet);
      expect(chipIsSelected(root, 'settings-chip-cooking-skill-intermediate')).toBe(true);
      expect(chipIsSelected(root, 'settings-chip-cooking-skill-advanced')).toBe(false);

      await press(root, 'settings-chip-cooking-skill-beginner');
      await press(root, 'settings-sheet-save');

      expect(context.updateProfile).toHaveBeenCalledWith({
        displayName: 'Lucca Giordana',
        householdSize: 2,
        cookingSkill: 'beginner',
      });
      expect(rowLabel(root, 'settings-row-cooking-skill')).toBe(
        'Experiencia cocinando, Estoy arrancando'
      );
    });

    it('shows the validation message next to an empty name and saves nothing', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-display-name');
      await typeInto(root, 'settings-input-display-name', '   ');
      await press(root, 'settings-sheet-save');

      expect(context.updateProfile).not.toHaveBeenCalled();
      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-field-error-display-name').props.children).toBe(
        'Ingresá un nombre de 1 a 60 caracteres.'
      );
      expect(queryHost(root, 'settings-sheet-error')).toBeNull();
    });

    it('starts from the saved value again after a cancelled edit', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-display-name');
      await typeInto(root, 'settings-input-display-name', 'Otro nombre');
      await press(root, 'settings-sheet-cancel');

      expect(isSheetOpen(root)).toBe(false);
      expect(context.updateProfile).not.toHaveBeenCalled();
      expect(rowLabel(root, 'settings-row-display-name')).toBe(
        'Nombre para mostrar, Lucca Giordana'
      );

      await press(root, 'settings-row-display-name');
      expect(getInput(root, 'settings-input-display-name').props.value).toBe('Lucca Giordana');
    });

    it('keeps the sheet open with the error when the save fails', async () => {
      const { root } = await renderScreen({
        context: {
          updateProfile: jest.fn(() => Promise.reject(new ApiError('network_error', 'offline'))),
        },
      });

      await press(root, 'settings-row-display-name');
      await typeInto(root, 'settings-input-display-name', 'Lucca');
      await press(root, 'settings-sheet-save');

      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-sheet-error').props.children).toBe(
        'No pudimos conectar con el servidor. Revisá tu conexión.'
      );
      expect(getInput(root, 'settings-input-display-name').props.value).toBe('Lucca');
      expect(getButton(root, 'settings-sheet-save').props.disabled).toBe(false);
      expect(rowLabel(root, 'settings-row-display-name')).toBe(
        'Nombre para mostrar, Lucca Giordana'
      );
      expect(getTexts(getHost(root, 'settings-account-card'))).toContain('Lucca Giordana');
    });

    it('disables save and shows progress while the save is in flight', async () => {
      let failSave: () => void = () => {};
      const updateProfile = jest.fn(
        () =>
          new Promise<never>((_resolve, reject) => {
            failSave = () => reject(new ApiError('timeout', 'slow'));
          })
      );
      const { root } = await renderScreen({ context: { updateProfile } });

      await press(root, 'settings-row-display-name');
      await press(root, 'settings-sheet-save');

      const saveButton = getButton(root, 'settings-sheet-save');
      expect(saveButton.props.disabled).toBe(true);
      expect(saveButton.props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(getTexts(saveButton)).toEqual(['Guardando…']);

      // Neither a second save nor a cancel goes through mid-save.
      await press(root, 'settings-sheet-save');
      await press(root, 'settings-sheet-cancel');
      expect(updateProfile).toHaveBeenCalledTimes(1);
      expect(isSheetOpen(root)).toBe(true);

      await act(async () => {
        failSave();
      });
      await flushEffects();

      expect(getTexts(getButton(root, 'settings-sheet-save'))).toEqual(['Guardar']);
      expect(getButton(root, 'settings-sheet-save').props.disabled).toBe(false);
    });
  });

  describe('editing preferences', () => {
    it('saves the diet and leaves the other preferences untouched', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-diet');

      const sheet = getHost(root, 'settings-sheet');
      expect(getTexts(sheet)).toEqual(
        expect.arrayContaining([
          'Dieta',
          'Sin preferencia',
          'Omnívoro',
          'Vegetariano',
          'Vegano',
          'Pescatariano',
        ])
      );
      expectNoRawCodes(sheet);
      expect(chipIsSelected(root, 'settings-chip-diet-vegetarian')).toBe(true);

      await press(root, 'settings-chip-diet-vegan');
      await press(root, 'settings-sheet-save');

      expect(context.saveUserPreferences).toHaveBeenCalledTimes(1);
      expect(context.saveUserPreferences).toHaveBeenCalledWith({
        diet: 'vegan',
        hardRestrictions: ['peanut', 'gluten'],
        softPreferences: ['spicy food', 'quick meals'],
      });
      expect(context.saveSlotCookingTimes).not.toHaveBeenCalled();
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegano');
      expect(rowLabel(root, 'settings-row-hard-restrictions')).toBe(
        'Restricciones duras, Maní, Gluten'
      );
    });

    it('can clear the diet', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-diet');
      await press(root, 'settings-chip-diet-none');
      await press(root, 'settings-sheet-save');

      expect(context.saveUserPreferences).toHaveBeenCalledWith({
        ...savedPreferences,
        diet: null,
      });
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Sin preferencia');
    });

    it('saves the hard restrictions picked from the catalog chips', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-hard-restrictions');
      expect(chipIsSelected(root, 'settings-chip-hard-restriction-gluten')).toBe(true);
      expect(chipIsSelected(root, 'settings-chip-hard-restriction-egg')).toBe(false);

      await press(root, 'settings-chip-hard-restriction-gluten');
      await press(root, 'settings-chip-hard-restriction-egg');
      await press(root, 'settings-sheet-save');

      expect(context.saveUserPreferences).toHaveBeenCalledWith({
        ...savedPreferences,
        hardRestrictions: ['peanut', 'egg'],
      });
      expect(rowLabel(root, 'settings-row-hard-restrictions')).toBe(
        'Restricciones duras, Maní, Huevo'
      );
    });

    it('never drops a restriction the catalog cannot show', async () => {
      const { root, context } = await renderScreen({
        context: {
          fetchUserPreferences: jest.fn(() =>
            Promise.resolve({ ...savedPreferences, hardRestrictions: ['sesame', 'gluten'] })
          ),
        },
      });
      expect(rowLabel(root, 'settings-row-hard-restrictions')).toBe(
        'Restricciones duras, Gluten +1'
      );

      await press(root, 'settings-row-hard-restrictions');
      for (const text of getTexts(getHost(root, 'settings-sheet'))) {
        expect(text).not.toContain('sesame');
      }
      await press(root, 'settings-chip-hard-restriction-gluten');
      await press(root, 'settings-sheet-save');

      expect(context.saveUserPreferences).toHaveBeenCalledWith({
        ...savedPreferences,
        hardRestrictions: ['sesame'],
      });
      expect(rowLabel(root, 'settings-row-hard-restrictions')).toBe('Restricciones duras, +1');
    });

    it('saves the soft preferences typed as a comma list', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-soft-preferences');
      expect(getInput(root, 'settings-input-soft-preferences').props.value).toBe(
        'spicy food, quick meals'
      );

      await typeInto(root, 'settings-input-soft-preferences', 'cilantro,  picante, ');
      await press(root, 'settings-sheet-save');

      expect(context.saveUserPreferences).toHaveBeenCalledWith({
        ...savedPreferences,
        softPreferences: ['cilantro', 'picante'],
      });
      expect(rowLabel(root, 'settings-row-soft-preferences')).toBe(
        'Preferencias suaves, cilantro, picante'
      );
    });

    it('keeps the sheet open and the row unchanged when the save fails, then retries', async () => {
      const saveUserPreferences = jest
        .fn<Promise<UserPreferences>, [UserPreferencesPayload]>()
        .mockRejectedValueOnce(fixtureInvalidDietError())
        .mockImplementation((payload) => Promise.resolve(payload));
      const { root } = await renderScreen({ context: { saveUserPreferences } });

      await press(root, 'settings-row-diet');
      await press(root, 'settings-chip-diet-vegan');
      await press(root, 'settings-sheet-save');

      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-sheet-error').props.children).toBe(
        'La dieta elegida no es válida.'
      );
      expect(chipIsSelected(root, 'settings-chip-diet-vegan')).toBe(true);
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegetariano');

      await press(root, 'settings-sheet-save');

      expect(saveUserPreferences).toHaveBeenCalledTimes(2);
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-diet')).toBe('Dieta, Vegano');
    });
  });

  describe('editing a meal slot', () => {
    it('saves the slot and leaves the other slots untouched', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-slot-lunch');

      const sheet = getHost(root, 'settings-sheet');
      expect(getTexts(sheet)).toEqual(
        expect.arrayContaining([
          'Almuerzo',
          'No cocino',
          '10 min',
          '20 min',
          '30 min',
          '45 min',
          '60 min',
          'Liviano',
          'Normal',
          'Abundante',
        ])
      );
      expectNoRawCodes(sheet);
      expect(chipIsSelected(root, 'settings-chip-minutes-30')).toBe(true);
      expect(chipIsSelected(root, 'settings-chip-hunger-normal')).toBe(true);

      await press(root, 'settings-chip-minutes-60');
      await press(root, 'settings-chip-hunger-strong');
      await press(root, 'settings-sheet-save');

      expect(context.saveSlotCookingTimes).toHaveBeenCalledTimes(1);
      expect(context.saveSlotCookingTimes).toHaveBeenCalledWith({
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'light' },
        lunch: { cookingTimeMinutes: 60, hungerLevel: 'strong' },
        dinner: { cookingTimeMinutes: 45, hungerLevel: 'strong' },
      });
      expect(context.saveUserPreferences).not.toHaveBeenCalled();
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-slot-lunch')).toBe('Almuerzo, 60 min · Abundante');
      expect(rowLabel(root, 'settings-row-slot-breakfast')).toBe('Desayuno, No cocino · Liviano');
      expect(rowLabel(root, 'settings-row-slot-dinner')).toBe('Cena, 45 min · Abundante');
    });

    it('stores "No cocino" as zero minutes and keeps the hunger level', async () => {
      const { root, context } = await renderScreen();

      await press(root, 'settings-row-slot-dinner');
      await press(root, 'settings-chip-minutes-0');
      await press(root, 'settings-sheet-save');

      expect(context.saveSlotCookingTimes).toHaveBeenCalledWith({
        ...savedSlotTimes,
        dinner: { cookingTimeMinutes: 0, hungerLevel: 'strong' },
      });
      expect(rowLabel(root, 'settings-row-slot-dinner')).toBe('Cena, No cocino · Abundante');
    });

    it('keeps a saved time that is not a preset unless the user changes it', async () => {
      const customSlotTimes: SlotCookingTimes = {
        ...savedSlotTimes,
        lunch: { cookingTimeMinutes: 25, hungerLevel: 'normal' },
      };
      const { root, context } = await renderScreen({
        context: { fetchSlotCookingTimes: jest.fn(() => Promise.resolve(customSlotTimes)) },
      });

      await press(root, 'settings-row-slot-lunch');
      expect(chipIsSelected(root, 'settings-chip-minutes-25')).toBe(true);

      await press(root, 'settings-chip-hunger-light');
      await press(root, 'settings-sheet-save');

      expect(context.saveSlotCookingTimes).toHaveBeenCalledWith({
        ...savedSlotTimes,
        lunch: { cookingTimeMinutes: 25, hungerLevel: 'light' },
      });
    });

    it('keeps the sheet open and the row unchanged when the save fails', async () => {
      const { root } = await renderScreen({
        context: {
          saveSlotCookingTimes: jest.fn(() =>
            Promise.reject(fixtureValidationDinnerMinutesApiError())
          ),
        },
      });

      await press(root, 'settings-row-slot-dinner');
      await press(root, 'settings-chip-minutes-10');
      await press(root, 'settings-sheet-save');

      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-sheet-error').props.children).toBe(
        'Los datos ingresados no son válidos.'
      );
      expect(rowLabel(root, 'settings-row-slot-dinner')).toBe('Cena, 45 min · Abundante');
    });
  });

  describe('editors over data that is not loaded', () => {
    const DEPENDENT_ROWS = [
      'settings-row-diet',
      'settings-row-hard-restrictions',
      'settings-row-soft-preferences',
      'settings-row-slot-breakfast',
      'settings-row-slot-lunch',
      'settings-row-slot-dinner',
    ];

    it('stay closed after a failed load, while the profile rows still open', async () => {
      const fetchUserPreferences = jest
        .fn<Promise<UserPreferences>, []>()
        .mockRejectedValueOnce(new Error('load failed'))
        .mockResolvedValue(savedPreferences);
      const { root, context } = await renderScreen({ context: { fetchUserPreferences } });

      for (const testID of DEPENDENT_ROWS) {
        expect(getButton(root, testID).props.disabled).toBe(true);
        // Even a press that gets through must not open an editor over missing data.
        await press(root, testID);
        expect(isSheetOpen(root)).toBe(false);
      }
      expect(context.saveUserPreferences).not.toHaveBeenCalled();
      expect(context.saveSlotCookingTimes).not.toHaveBeenCalled();

      await press(root, 'settings-row-display-name');
      expect(isSheetOpen(root)).toBe(true);
      await press(root, 'settings-sheet-cancel');

      await press(root, 'settings-load-retry');
      for (const testID of DEPENDENT_ROWS) {
        expect(getButton(root, testID).props.disabled).toBe(false);
      }
      await press(root, 'settings-row-diet');
      expect(isSheetOpen(root)).toBe(true);
    });

    it('stay closed while the load is still in flight', async () => {
      const { root } = await renderScreen({
        context: {
          fetchSlotCookingTimes: jest.fn(() => new Promise<SlotCookingTimes>(() => {})),
        },
      });

      for (const testID of DEPENDENT_ROWS) {
        expect(getButton(root, testID).props.disabled).toBe(true);
        await press(root, testID);
        expect(isSheetOpen(root)).toBe(false);
      }
    });
  });

  describe('weekly budget', () => {
    const memberMe = (): CurrentMe => ({ ...makeMe(), membership: { role: 'member' } });

    it('shows the Budget in pesos, marked while it is the default', async () => {
      const { root } = await renderScreen();

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(1);
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
    });

    it('lets the owner set it, showing the minimum, and shows the saved value', async () => {
      const { root } = await renderScreen();

      await press(root, 'settings-row-budget');
      expect(isSheetOpen(root)).toBe(true);
      expect(getTexts(getHost(root, 'settings-sheet'))).toEqual(
        expect.arrayContaining(['Presupuesto semanal', 'Mínimo: $30.000 por semana'])
      );
      expect(getInput(root, 'settings-budget-input').props.value).toBe('45000');

      await typeInto(root, 'settings-budget-input', '60.000');
      await press(root, 'settings-sheet-save');

      expect(mockUpdateAccountBudget).toHaveBeenCalledWith({ weeklyBudgetCents: 6000000 });
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-budget')).toBe('Presupuesto semanal, $60.000');
    });

    it('keeps following the tier default when the owner saves it unchanged', async () => {
      const { root } = await renderScreen();

      await press(root, 'settings-row-budget');
      await typeInto(root, 'settings-budget-input', '45.000');
      await press(root, 'settings-sheet-save');

      expect(mockUpdateAccountBudget).not.toHaveBeenCalled();
      expect(isSheetOpen(root)).toBe(false);
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
    });

    it('explains an amount below the minimum without sending it', async () => {
      const { root } = await renderScreen();

      await press(root, 'settings-row-budget');
      await typeInto(root, 'settings-budget-input', '29999');
      await press(root, 'settings-sheet-save');

      expect(mockUpdateAccountBudget).not.toHaveBeenCalled();
      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-sheet-error').props.children).toBe('Ingresá $30.000 o más.');
    });

    it("keeps the sheet open with the server's reason when the save is refused", async () => {
      mockUpdateAccountBudget.mockRejectedValue(
        new ApiError('not_owner', 'Only the owner of the account can change this.', 403)
      );
      const { root } = await renderScreen();

      await press(root, 'settings-row-budget');
      await typeInto(root, 'settings-budget-input', '60000');
      await press(root, 'settings-sheet-save');

      expect(isSheetOpen(root)).toBe(true);
      expect(getHost(root, 'settings-sheet-error').props.children).toBe(
        'Solo quien administra la cuenta puede cambiar esto.'
      );
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
    });

    it('shows the new minimum after the owner changes the household size', async () => {
      const { root } = await renderScreen();
      mockFetchAccountBudget.mockResolvedValue({
        budget: { ...defaultBudget, minWeeklyBudgetCents: 4500000 },
      });

      await press(root, 'settings-row-household-size');
      await press(root, 'settings-stepper-increment');
      await press(root, 'settings-sheet-save');

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(2);
      await press(root, 'settings-row-budget');
      expect(getTexts(getHost(root, 'settings-sheet'))).toContain('Mínimo: $45.000 por semana');
    });

    it('keeps the Budget editable when that refresh fails', async () => {
      const { root } = await renderScreen();
      mockFetchAccountBudget.mockRejectedValue(new ApiError('network_error', 'offline'));

      await press(root, 'settings-row-household-size');
      await press(root, 'settings-stepper-increment');
      await press(root, 'settings-sheet-save');

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(2);
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
      expect(getButton(root, 'settings-row-budget').props.disabled).toBe(false);
    });

    it('a late refresh does not overwrite a Budget the owner saved meanwhile', async () => {
      const { root } = await renderScreen();
      let answerRefresh: (value: unknown) => void = () => {};
      mockFetchAccountBudget.mockReturnValue(
        new Promise((resolve) => {
          answerRefresh = resolve;
        })
      );

      await press(root, 'settings-row-household-size');
      await press(root, 'settings-stepper-increment');
      await press(root, 'settings-sheet-save');

      await press(root, 'settings-row-budget');
      await typeInto(root, 'settings-budget-input', '60000');
      await press(root, 'settings-sheet-save');
      expect(rowLabel(root, 'settings-row-budget')).toBe('Presupuesto semanal, $60.000');

      await act(async () => {
        answerRefresh({ budget: defaultBudget });
      });
      await flushEffects();

      expect(rowLabel(root, 'settings-row-budget')).toBe('Presupuesto semanal, $60.000');
    });

    it('is not fetched again when the saved profile keeps the household size', async () => {
      const { root } = await renderScreen();

      await press(root, 'settings-row-display-name');
      await typeInto(root, 'settings-input-display-name', 'Lucca G');
      await press(root, 'settings-sheet-save');

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(1);
    });

    it('shows it to a member who is not the owner, without a way to edit it', async () => {
      const { root } = await renderScreen({ me: memberMe() });

      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
      expect(queryButton(root, 'settings-row-budget')).toBeNull();
    });

    it('cannot be opened while it failed to load, and the other rows still work', async () => {
      mockFetchAccountBudget.mockRejectedValue(new ApiError('network_error', 'offline'));
      const { root } = await renderScreen();

      expect(rowLabel(root, 'settings-row-budget')).toBe('Presupuesto semanal, No disponible');
      expect(getButton(root, 'settings-row-budget').props.disabled).toBe(true);
      expect(getButton(root, 'settings-row-diet').props.disabled).toBe(false);
    });

    it('offers its own retry when only the Budget failed to load', async () => {
      mockFetchAccountBudget.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const fetchUserPreferences = jest.fn().mockResolvedValue(savedPreferences);
      const { root } = await renderScreen({ context: { fetchUserPreferences } });

      expect(rowLabel(root, 'settings-row-budget')).toBe('Presupuesto semanal, No disponible');
      expect(queryHost(root, 'settings-load-retry')).toBeNull();

      await press(root, 'settings-budget-retry');

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(2);
      expect(fetchUserPreferences).toHaveBeenCalledTimes(1);
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
      expect(getButton(root, 'settings-row-budget').props.disabled).toBe(false);
      expect(queryHost(root, 'settings-budget-retry')).toBeNull();
    });

    it('loads it again with the retry of a failed load', async () => {
      mockFetchAccountBudget.mockRejectedValueOnce(new ApiError('network_error', 'offline'));
      const fetchUserPreferences = jest
        .fn()
        .mockRejectedValueOnce(new ApiError('network_error', 'offline'))
        .mockResolvedValue(savedPreferences);
      const { root } = await renderScreen({ context: { fetchUserPreferences } });

      // One retry covers both failures, so the Budget gets no second notice.
      expect(queryHost(root, 'settings-budget-retry')).toBeNull();
      await press(root, 'settings-load-retry');

      expect(mockFetchAccountBudget).toHaveBeenCalledTimes(2);
      expect(rowLabel(root, 'settings-row-budget')).toBe(
        'Presupuesto semanal, $45.000 (por defecto)'
      );
    });
  });

  describe('row accessibility', () => {
    it('exposes an editable row as a button labelled with its value', async () => {
      const { root } = await renderScreen();

      const row = getButton(root, 'settings-row-diet');
      expect(row.props.accessibilityLabel).toBe('Dieta, Vegetariano');
      expect(row.props.accessibilityState).toEqual({ disabled: false });
    });
  });
});
