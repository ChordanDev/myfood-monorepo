// Step navigation of the onboarding wizard.
//
// Mounts the real `OnboardingScreen` with a controlled AuthContext and drives
// it the way a user does: typing, tapping chips and pressing the primary
// button. The payload builder, the catalog and the submit gate are NOT mocked,
// so the submit case proves the wizard still submits what
// `buildOnboardingPayload` produces.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { Alert, BackHandler } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import type { AuthContextValue, CurrentMe } from '@/features/auth/types/auth';
import { AuthContext } from '@/features/auth/context/AuthContext';
import { fixtureCurrentMeBeforeOnboarding } from '@/features/auth/fixtures/currentMe';
import {
  fixtureInvalidCookingSkillError,
  fixtureOnboardingCompletion,
} from '@/features/onboarding/fixtures/onboardingCompletion';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';
import { buildOnboardingPayload } from '@/features/onboarding/utils/onboardingPayload';
import {
  fixtureInvalidDietError,
  fixtureInvalidHardRestrictionError,
} from '@/features/preferences/fixtures/preferences';
import {
  fixtureInvalidHungerLevelError,
  fixtureValidationErrorDinnerCookingTimeMinutesError,
} from '@/features/preferences/fixtures/slotCookingTimes';

const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement('RedirectMock', { testID: 'redirect' }, href),
    useRouter: () => ({ replace: mockRouterReplace, push: jest.fn() }),
  };
});

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: unknown }) => children ?? null,
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

// A stand-in palette: the values only need to be parseable colors.
jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorBlack: '#101010',
      colorDark: '#202020',
      colorMedium: '#505050',
      colorLight: '#a0a0a0',
      primaryAccent: '#e09040',
      appBg: '#e0e0e0',
      icon: '#c0c0c0',
      textBlack: '#181818',
      textDark: '#1c1c1c',
      textMedium: '#c4c4c4',
      textLight: '#f0f0f0',
      primaryAccentIntense: '#404040',
    },
  }),
}));

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: ({ children }: { children: unknown }) => children,
  ShadowSurface: ({ children }: { children: unknown }) => children,
}));

// The message lookup is the real one, so a refused completion shows the catalog text.
jest.mock('@/services/authService', () => ({
  getAuthErrorMessage: jest.requireActual('@/api/errors').getAuthErrorMessage,
  AuthApiError: class extends Error {},
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The frozen `GET /api/me` body of a User who has not finished Onboarding.
const ME: CurrentMe = fixtureCurrentMeBeforeOnboarding();

function buildContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    me: ME,
    user: ME.user,
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    token: 'access-1',
    isLoading: false,
    isAuthenticated: true,
    canUseApp: true,
    accessReason: null,
    isTrialExpired: false,
    isComplete: false,
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

function renderOnboarding(overrides: Partial<AuthContextValue> = {}) {
  let tree: ReactTestRenderer | null = null;
  act(() => {
    tree = create(
      React.createElement(
        AuthContext.Provider,
        { value: buildContext(overrides) },
        React.createElement(OnboardingScreen)
      )
    );
  });
  return tree!;
}

function textContent(node: ReactTestInstance | string): string {
  if (typeof node === 'string') return node;
  return node.children.map(textContent).join('');
}

// A pressable shows up several times in the test tree (the component and the
// host views it renders), so the queries take the first match that can be
// pressed.
function findControl(
  root: ReactTestInstance,
  role: string,
  matches: (node: ReactTestInstance) => boolean,
  index = 0
): ReactTestInstance {
  const seen = new Set<unknown>();
  const found = root
    .findAll(
      (node) =>
        node.props.accessibilityRole === role &&
        typeof node.props.onPress === 'function' &&
        matches(node)
    )
    .filter((node) => {
      // Parent and child wrappers of one control share the same handler.
      if (seen.has(node.props.onPress)) return false;
      seen.add(node.props.onPress);
      return true;
    });
  if (found[index] === undefined) {
    throw new Error(`No ${role} control at index ${index}`);
  }
  return found[index];
}

const byText = (text: string) => (node: ReactTestInstance) => textContent(node) === text;
const byLabel = (label: string) => (node: ReactTestInstance) =>
  node.props.accessibilityLabel === label;

function hasControl(root: ReactTestInstance, role: string, label: string): boolean {
  return (
    root.findAll(
      (node) => node.props.accessibilityRole === role && node.props.accessibilityLabel === label
    ).length > 0
  );
}

function findInput(root: ReactTestInstance, label: string): ReactTestInstance {
  const found = root.findAll(
    (node) =>
      node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function'
  );
  if (found.length === 0) throw new Error(`No input labelled "${label}"`);
  return found[0];
}

function press(node: ReactTestInstance) {
  act(() => {
    node.props.onPress();
  });
}

function pressButton(root: ReactTestInstance, text: string) {
  press(findControl(root, 'button', byText(text)));
}

function pressChip(root: ReactTestInstance, text: string, index = 0) {
  press(findControl(root, 'radio', byText(text), index));
}

function type(root: ReactTestInstance, label: string, value: string) {
  act(() => {
    findInput(root, label).props.onChangeText(value);
  });
}

function isChecked(root: ReactTestInstance, role: string, text: string, index = 0): boolean {
  return findControl(root, role, byText(text), index).props.accessibilityState.checked === true;
}

function progressNow(root: ReactTestInstance): number {
  return root.findAll((node) => node.props.accessibilityRole === 'progressbar')[0].props
    .accessibilityValue.now;
}

function inlineError(root: ReactTestInstance): string | null {
  const alerts = root.findAll((node) => node.props.accessibilityRole === 'alert');
  return alerts.length === 0 ? null : textContent(alerts[0]);
}

// What the stepper announces between its two buttons, e.g. "2 comensales".
function dinersLabel(root: ReactTestInstance): string {
  return root.findAll((node) => /^\d+ comensal(es)?$/.test(node.props.accessibilityLabel ?? ''))[0]
    .props.accessibilityLabel;
}

function fillHousehold(root: ReactTestInstance, name = 'Lucca') {
  type(root, 'Nombre para mostrar', name);
}

function goToMealTimes(root: ReactTestInstance) {
  fillHousehold(root);
  pressButton(root, 'CONTINUAR');
  pressButton(root, 'CONTINUAR');
}

describe('OnboardingScreen — three steps', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts on step 1 of 3, with nothing to go back to', () => {
    const { root } = renderOnboarding();

    expect(textContent(root)).toContain('Paso 1 de 3');
    expect(textContent(root)).toContain('Tu hogar');
    expect(progressNow(root)).toBe(1);
    expect(hasControl(root, 'button', 'Volver al paso anterior')).toBe(false);
    expect(textContent(root)).toContain('CONTINUAR');
  });

  // The name field starts with the display name sign-up gave the User, so an
  // empty name is one the User cleared.
  it('stays on step 1 and explains why when the name is empty', () => {
    const { root } = renderOnboarding();
    type(root, 'Nombre para mostrar', '');

    pressButton(root, 'CONTINUAR');

    expect(progressNow(root)).toBe(1);
    expect(inlineError(root)).toBe('Escribí un nombre para mostrar.');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('clears the message as soon as the user edits the step', () => {
    const { root } = renderOnboarding();
    type(root, 'Nombre para mostrar', '');
    pressButton(root, 'CONTINUAR');
    expect(inlineError(root)).not.toBeNull();

    type(root, 'Nombre para mostrar', 'L');

    expect(inlineError(root)).toBeNull();
  });

  it('advances to step 2 and then to step 3 with valid data', () => {
    const { root } = renderOnboarding();
    fillHousehold(root);

    pressButton(root, 'CONTINUAR');
    expect(progressNow(root)).toBe(2);
    expect(textContent(root)).toContain('Paso 2 de 3');
    expect(textContent(root)).toContain('Preferencias');

    pressButton(root, 'CONTINUAR');
    expect(progressNow(root)).toBe(3);
    expect(textContent(root)).toContain('Paso 3 de 3');
    expect(textContent(root)).toContain('Tiempos por comida');
    expect(textContent(root)).toContain('FINALIZAR');
    expect(textContent(root)).not.toContain('CONTINUAR');
  });

  it('moves the diners between 1 and 20 and disables the stepper at both ends', () => {
    const { root } = renderOnboarding();
    const fewer = () => findControl(root, 'button', byLabel('Una persona menos'));
    const more = () => findControl(root, 'button', byLabel('Una persona más'));

    expect(dinersLabel(root)).toBe('1 comensal');
    expect(fewer().props.accessibilityState.disabled).toBe(true);
    expect(more().props.accessibilityState.disabled).toBe(false);

    for (let i = 0; i < 25; i += 1) press(more());

    expect(dinersLabel(root)).toBe('20 comensales');
    expect(more().props.accessibilityState.disabled).toBe(true);
    expect(fewer().props.accessibilityState.disabled).toBe(false);

    press(fewer());
    expect(dinersLabel(root)).toBe('19 comensales');
  });

  it('goes back one step with the back control and keeps what was entered', () => {
    const { root } = renderOnboarding();
    fillHousehold(root, 'Lucca');
    press(findControl(root, 'button', byLabel('Una persona más')));
    pressChip(root, 'Cocino seguido');
    pressButton(root, 'CONTINUAR');
    pressChip(root, 'Vegano');
    type(root, 'Preferencias suaves', 'cilantro');

    press(findControl(root, 'button', byLabel('Volver al paso anterior')));

    expect(progressNow(root)).toBe(1);
    expect(findInput(root, 'Nombre para mostrar').props.value).toBe('Lucca');
    expect(dinersLabel(root)).toBe('2 comensales');
    expect(isChecked(root, 'radio', 'Cocino seguido')).toBe(true);

    pressButton(root, 'CONTINUAR');

    expect(progressNow(root)).toBe(2);
    expect(isChecked(root, 'radio', 'Vegano')).toBe(true);
    expect(findInput(root, 'Preferencias suaves').props.value).toBe('cilantro');
  });

  it('goes back one step with the Android hardware back button, except on step 1', () => {
    type BackPressHandler = Parameters<typeof BackHandler.addEventListener>[1];
    const handlers: BackPressHandler[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    });
    const pressHardwareBack = () => {
      let handled = false;
      act(() => {
        const event = { type: 'hardwareBackPress', timeStamp: 0 };
        handled = handlers.some((handler) => handler(event) === true);
      });
      return handled;
    };
    const { root } = renderOnboarding();

    // Step 1 leaves the back press to the system.
    expect(pressHardwareBack()).toBe(false);

    fillHousehold(root);
    pressButton(root, 'CONTINUAR');
    expect(progressNow(root)).toBe(2);

    expect(pressHardwareBack()).toBe(true);
    expect(progressNow(root)).toBe(1);
    expect(pressHardwareBack()).toBe(false);
  });

  it('blocks FINALIZAR on step 3 while a manual slot has no minutes', async () => {
    const completeOnboarding = jest.fn();
    const { root } = renderOnboarding({ completeOnboarding });
    goToMealTimes(root);
    // Slots render in meal order: index 1 is lunch.
    pressChip(root, 'Manual', 1);

    await act(async () => {
      await findControl(root, 'button', byText('FINALIZAR')).props.onPress();
    });

    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(progressNow(root)).toBe(3);
    expect(inlineError(root)).toBe('Almuerzo: ingresá los minutos, con un mínimo de 1.');

    type(root, 'Minutos de Almuerzo', '25');
    expect(inlineError(root)).toBeNull();
  });

  it('offers only quick times the step accepts: no "0 min" preset', () => {
    const { root } = renderOnboarding();
    goToMealTimes(root);

    pressChip(root, 'Rápido', 0);

    const presets = root
      .findAll((node) => node.props.accessibilityRole === 'radio')
      .map(textContent)
      .filter((label) => label.endsWith(' min'));
    expect([...new Set(presets)]).toEqual(['10 min', '20 min', '30 min', '45 min', '60 min']);
  });

  it('submits the payload built by buildOnboardingPayload and leaves for "/"', async () => {
    const completeOnboarding = jest.fn().mockResolvedValue(fixtureOnboardingCompletion());
    const { root } = renderOnboarding({ completeOnboarding });

    // Step 1: name, three diners, intermediate skill.
    type(root, 'Nombre para mostrar', '  Lucca ');
    press(findControl(root, 'button', byLabel('Una persona más')));
    press(findControl(root, 'button', byLabel('Una persona más')));
    pressChip(root, 'Me defiendo');
    pressButton(root, 'CONTINUAR');

    // Step 2: vegan, no gluten, two soft preferences.
    pressChip(root, 'Vegano');
    press(findControl(root, 'checkbox', byText('Gluten')));
    type(root, 'Preferencias suaves', 'cilantro, picante');
    pressButton(root, 'CONTINUAR');

    // Step 3: breakfast stays on "no cook", lunch is manual, dinner is quick.
    pressChip(root, 'Manual', 1);
    type(root, 'Minutos de Almuerzo', '25');
    pressChip(root, 'Abundante', 1);
    pressChip(root, 'Rápido', 2);
    pressChip(root, '45 min');

    await act(async () => {
      await findControl(root, 'button', byText('FINALIZAR')).props.onPress();
    });

    const expected = buildOnboardingPayload({
      displayName: 'Lucca',
      householdSize: 3,
      cookingSkill: 'intermediate',
      preferences: {
        diet: 'vegan',
        hardRestrictions: ['gluten'],
        softPreferences: ['cilantro', 'picante'],
      },
      slotCookingTimes: {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 25, hungerLevel: 'strong' },
        dinner: { cookingTimeMinutes: 45, hungerLevel: 'normal' },
      },
    });
    // The contract of `OnboardingCompletionRequest`, spelled out.
    expect(expected).toEqual({
      profile: { displayName: 'Lucca', householdSize: 3, cookingSkill: 'intermediate' },
      preferences: {
        diet: 'vegan',
        hardRestrictions: ['gluten'],
        softPreferences: ['cilantro', 'picante'],
      },
      slotCookingTimes: {
        breakfast: { cookingTimeMinutes: 0, hungerLevel: 'normal' },
        lunch: { cookingTimeMinutes: 25, hungerLevel: 'strong' },
        dinner: { cookingTimeMinutes: 45, hungerLevel: 'normal' },
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(completeOnboarding).toHaveBeenCalledWith(expected);
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // Each refusal the api answers to an onboarding body with an invalid field, as the api
  // client throws it from the frozen envelope.
  it.each([
    [
      'validation_error',
      fixtureValidationErrorDinnerCookingTimeMinutesError,
      'Los datos ingresados no son válidos.',
    ],
    [
      'invalid_cooking_skill',
      fixtureInvalidCookingSkillError,
      'La experiencia cocinando seleccionada no es válida.',
    ],
    ['invalid_diet', fixtureInvalidDietError, 'La dieta elegida no es válida.'],
    [
      'invalid_hard_restriction',
      fixtureInvalidHardRestrictionError,
      'Una de las restricciones elegidas no es válida.',
    ],
    [
      'invalid_hunger_level',
      fixtureInvalidHungerLevelError,
      'El nivel de hambre elegido no es válido.',
    ],
  ])(
    'shows the message of %s and stays on the form when the completion is refused',
    async (_code, frozenError, message) => {
      const completeOnboarding = jest.fn().mockRejectedValue(frozenError());
      const { root } = renderOnboarding({ completeOnboarding });
      goToMealTimes(root);

      await act(async () => {
        await findControl(root, 'button', byText('FINALIZAR')).props.onPress();
      });

      expect(completeOnboarding).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith('No pudimos guardar', message);
      expect(mockRouterReplace).not.toHaveBeenCalled();
    }
  );
});
