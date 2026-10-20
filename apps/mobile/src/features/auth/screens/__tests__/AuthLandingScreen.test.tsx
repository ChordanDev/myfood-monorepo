// Tests for the sign-in entry points of the landing screen.
//
// The screen offers the email field, the login code request, the sign-up entry
// and the identity provider buttons: Google on iOS and Android, Apple on iOS
// when the device supports it, Facebook never.

/* eslint-disable @typescript-eslint/no-require-imports */

import * as React from 'react';
import { Alert, Platform, Text } from 'react-native';
import { SvgXml } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
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
const mockRouterReplace = jest.fn();
const mockRequestVerificationCode = jest.fn();
const mockSignInWithSocial = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
}));

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), signIn: jest.fn() },
  isCancelledResponse: (response: { type: string }) => response.type === 'cancelled',
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
  useAuth: () => ({
    requestVerificationCode: mockRequestVerificationCode,
    signInWithSocial: mockSignInWithSocial,
  }),
}));

jest.mock('@/services/authService', () => ({
  getAuthErrorMessage: (error: { code?: string }) => `message for ${error.code}`,
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

// Apple's availability is asynchronous, so the screen settles inside an async act.
async function renderScreen(): Promise<ReactTestInstance> {
  let tree: ReturnType<typeof create>;

  await act(async () => {
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
    mockRouterReplace.mockReset();
    mockRequestVerificationCode.mockReset();
    mockRequestVerificationCode.mockResolvedValue({ resendAvailableInSeconds: 60 });
    mockSignInWithSocial.mockReset();
    mockSignInWithSocial.mockResolvedValue(undefined);
    jest.mocked(AppleAuthentication.isAvailableAsync).mockReset();
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(true);
    jest.mocked(AppleAuthentication.signInAsync).mockReset();
    jest.mocked(GoogleSignin.signIn).mockReset();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-id';
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  });

  it('offers Google and Apple on iOS, and never Facebook', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const root = await renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([
      'Iniciar sesión con Google',
      'Iniciar sesión con Apple',
    ]);
    expect(renderedTexts(root).filter((text) => /facebook/i.test(text))).toEqual([]);
  });

  it('offers Google only on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const root = await renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([
      'Iniciar sesión con Google',
    ]);
    expect(AppleAuthentication.isAvailableAsync).not.toHaveBeenCalled();
  });

  it('hides Apple on an iOS device that cannot use it', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(AppleAuthentication.isAvailableAsync).mockResolvedValue(false);
    const root = await renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([
      'Iniciar sesión con Google',
    ]);
  });

  it('hides Google in a build without its web client ID', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const root = await renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([]);
  });

  it('hides Google on iOS in a build without its iOS client ID', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const root = await renderScreen();

    expect(accessibilityLabels(root).filter((label) => SIGN_IN_PROVIDER.test(label))).toEqual([
      'Iniciar sesión con Apple',
    ]);
  });

  it('draws the Apple logo in a palette color', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const root = await renderScreen();

    const logo = firstByTestId(root, 'e2e-social-apple').findByType(SvgXml);
    expect(logo.props.xml).toContain('fill="currentColor"');
    expect(logo.props.color).toBe(mockTheme.textBlack);
  });

  it('offers the login code request and the sign-up entry beside the provider buttons', async () => {
    const root = await renderScreen();

    expect(accessibilityLabels(root, 'button')).toEqual([
      'Iniciar Sesión',
      'Crear una cuenta',
      'Iniciar sesión con Google',
      'Iniciar sesión con Apple',
    ]);
    expect(root.findAllByProps({ testID: 'e2e-login-email' }).length).toBeGreaterThan(0);
  });

  it('requests a login code for the typed email and opens the verification step', async () => {
    const root = await renderScreen();

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
    const root = await renderScreen();
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

  describe('provider sign-in', () => {
    beforeEach(() => {
      jest.replaceProperty(Platform, 'OS', 'ios');
    });

    it('signs in with the Google identity token and takes the route a verified code takes', async () => {
      jest
        .mocked(GoogleSignin.signIn)
        .mockResolvedValue({ type: 'success', data: { idToken: 'google-token' } } as never);
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Google').props.onPress();
      });

      expect(mockSignInWithSocial).toHaveBeenCalledWith('google', 'google-token');
      expect(mockRouterReplace).toHaveBeenCalledWith('/');
    });

    it('signs in with the Apple identity token, asking for email and full name', async () => {
      jest
        .mocked(AppleAuthentication.signInAsync)
        .mockResolvedValue({ identityToken: 'apple-token' } as never);
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Apple').props.onPress();
      });

      expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
      });
      expect(mockSignInWithSocial).toHaveBeenCalledWith('apple', 'apple-token');
      expect(mockRouterReplace).toHaveBeenCalledWith('/');
    });

    it('shows no error and signs nothing in when the User cancels Google', async () => {
      jest.mocked(GoogleSignin.signIn).mockResolvedValue({ type: 'cancelled', data: null });
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Google').props.onPress();
      });

      expect(mockSignInWithSocial).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it('shows no error and signs nothing in when the User cancels Apple', async () => {
      jest
        .mocked(AppleAuthentication.signInAsync)
        .mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Apple').props.onPress();
      });

      expect(mockSignInWithSocial).not.toHaveBeenCalled();
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('shows the message of the error code the API answered, and stays on the screen', async () => {
      jest
        .mocked(GoogleSignin.signIn)
        .mockResolvedValue({ type: 'success', data: { idToken: 'google-token' } } as never);
      mockSignInWithSocial.mockRejectedValue(
        Object.assign(new Error('refused'), { code: 'social_email_unverified' })
      );
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Google').props.onPress();
      });

      expect(Alert.alert).toHaveBeenCalledWith('Error', 'message for social_email_unverified');
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });

    it('shows an error when the provider returns no identity token', async () => {
      jest
        .mocked(AppleAuthentication.signInAsync)
        .mockResolvedValue({ identityToken: null } as never);
      const root = await renderScreen();

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Apple').props.onPress();
      });

      expect(mockSignInWithSocial).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'message for social_token_invalid');
    });

    it('disables the provider buttons while a sign-in is in flight', async () => {
      jest
        .mocked(GoogleSignin.signIn)
        .mockResolvedValue({ type: 'success', data: { idToken: 'google-token' } } as never);
      let finishSignIn: () => void = () => {};
      mockSignInWithSocial.mockReturnValue(
        new Promise<void>((resolve) => (finishSignIn = resolve))
      );
      const root = await renderScreen();
      const disabled = (label: string) =>
        firstByLabel(root, label).props.accessibilityState?.disabled;

      expect(disabled('Iniciar sesión con Google')).toBe(false);

      await act(async () => {
        firstByLabel(root, 'Iniciar sesión con Google').props.onPress();
      });

      expect(disabled('Iniciar sesión con Google')).toBe(true);
      expect(disabled('Iniciar sesión con Apple')).toBe(true);

      await act(async () => {
        finishSignIn();
      });

      expect(disabled('Iniciar sesión con Google')).toBe(false);
    });
  });
});
