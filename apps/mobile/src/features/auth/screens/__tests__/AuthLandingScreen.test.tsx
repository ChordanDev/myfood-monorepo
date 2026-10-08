// Tests for the sign-in entry points of the landing screen.
//
// The email code contract is the only sign-in path of the app, so the screen
// must offer the email field, the login code request and the sign-up entry,
// and no control for an identity provider.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { RecipeThemeConfig } from '@/types/domain';
import { AuthLandingScreen } from '../AuthLandingScreen';

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

const mockRouterPush = jest.fn();
const mockRequestVerificationCode = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: unknown }) => children,
}));

jest.mock('react-native-reanimated', () => {
  const { View: MockView } = require('react-native');
  return { __esModule: true, default: { View: MockView } };
});

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({ inputAnimatedStyle: {}, isKeyboardOpen: false }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: ({ children }: { children: unknown }) => children,
  TitlePrimary: () => null,
  TopFadeMask: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ requestVerificationCode: mockRequestVerificationCode }),
}));

jest.mock('@/services/authService', () => ({
  getAuthErrorMessage: () => 'boom',
}));

// The sign-up form is a modal of its own; here it is a probe that exposes the
// props the screen drives it with.
jest.mock('@/features/auth/components/RegisterEntryModal', () => {
  const ReactMock = require('react');
  return {
    RegisterEntryModal: (props: object) => ReactMock.createElement('RegisterEntryModalMock', props),
  };
});

const SIGN_IN_PROVIDER = /google|facebook|apple/i;

function renderScreen(): ReactTestInstance {
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<AuthLandingScreen />);
  });

  return tree!.root;
}

// The assertions compare strings, never test instances: printing the diff of
// an instance walks the whole fiber tree.
//
// A pressable matches as a composite and again as its host view, so the labels
// are deduplicated, in document order.
function accessibilityLabels(root: ReactTestInstance, role?: string): string[] {
  const labels = root
    .findAll(
      (node) =>
        typeof node.props.accessibilityLabel === 'string' &&
        (role === undefined || node.props.accessibilityRole === role)
    )
    .map((node) => node.props.accessibilityLabel as string);

  return [...new Set(labels)];
}

function renderedTexts(root: ReactTestInstance): string[] {
  return root
    .findAllByType(Text)
    .map((node) => React.Children.toArray(node.props.children).join(''));
}

function firstByTestId(root: ReactTestInstance, testID: string): ReactTestInstance {
  return root.findAllByProps({ testID })[0];
}

function firstByLabel(root: ReactTestInstance, accessibilityLabel: string): ReactTestInstance {
  return root.findAllByProps({ accessibilityLabel })[0];
}

describe('AuthLandingScreen sign-in entry points', () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockRequestVerificationCode.mockReset();
    mockRequestVerificationCode.mockResolvedValue({ resendAvailableInSeconds: 60 });
  });

  it('offers no Google, Facebook or Apple sign-in control', () => {
    const root = renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([]);
    expect(renderedTexts(root).filter((text) => /iniciar sesión con/i.test(text))).toEqual([]);
  });

  it('offers the login code request and the sign-up entry as its only buttons', () => {
    const root = renderScreen();

    expect(accessibilityLabels(root, 'button')).toEqual(['Iniciar Sesión', 'Crear una cuenta']);
    expect(root.findAllByProps({ testID: 'e2e-login-email' }).length).toBeGreaterThan(0);
  });

  it('requests a login code for the typed email and opens the verification step', async () => {
    const root = renderScreen();

    expect(firstByTestId(root, 'e2e-request-login-code').props.disabled).toBe(true);

    act(() => {
      firstByTestId(root, 'e2e-login-email').props.onChangeText('user@example.com');
    });

    expect(firstByTestId(root, 'e2e-request-login-code').props.disabled).toBe(false);

    await act(async () => {
      firstByTestId(root, 'e2e-request-login-code').props.onPress();
    });

    expect(mockRequestVerificationCode).toHaveBeenCalledWith('user@example.com', 'login');
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/register',
      params: { email: 'user@example.com', flow: 'login', cooldown: '60' },
    });
  });

  it('opens the sign-up entry and requests a sign-up code for its email', async () => {
    const root = renderScreen();
    const registerEntry = () => root.findByType('RegisterEntryModalMock' as never);

    expect(registerEntry().props.visible).toBe(false);

    act(() => {
      firstByLabel(root, 'Crear una cuenta').props.onPress();
    });

    expect(registerEntry().props.visible).toBe(true);

    await act(async () => {
      registerEntry().props.onContinue('new@example.com');
    });

    expect(mockRequestVerificationCode).toHaveBeenCalledWith('new@example.com', 'register');
    expect(registerEntry().props.visible).toBe(false);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/register',
      params: { email: 'new@example.com', flow: 'register', cooldown: '60' },
    });
  });
});
