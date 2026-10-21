import { Text } from 'react-native';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import type { RecipeThemeConfig } from '@/types/domain';
import { TrialExpiredScreen } from '../TrialExpiredScreen';

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

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: unknown }) => children,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
  SafeAreaContent: ({ children }: { children: unknown }) => children,
}));

type Props = Parameters<typeof TrialExpiredScreen>[0];

function render(props: Partial<Props> = {}) {
  let tree: ReturnType<typeof create> | null = null;
  act(() => {
    tree = create(<TrialExpiredScreen onSignOut={jest.fn()} {...props} />);
  });
  return tree!.root;
}

function texts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function find(root: ReactTestInstance, testID: string): ReactTestInstance | null {
  return root.findAll((node) => node.props.testID === testID && node.props.onPress)[0] ?? null;
}

describe('TrialExpiredScreen', () => {
  it('offers no subscription in a build that cannot sell it', () => {
    const root = render({ canSubscribe: false, onSubscribe: jest.fn() });

    expect(find(root, 'trial-expired-subscribe')).toBeNull();
    expect(texts(root)).toContain(
      'Para seguir usando MyFood, necesitás activar tu cuenta cuando la suscripción esté disponible.'
    );
  });

  it('opens the Paywall from "Suscribirme"', () => {
    const onSubscribe = jest.fn();
    const root = render({ canSubscribe: true, onSubscribe });

    expect(texts(root)).toContain('Suscribite para seguir usando MyFood con toda tu cuenta.');
    act(() => find(root, 'trial-expired-subscribe')!.props.onPress());

    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the purchase is being confirmed', () => {
    const root = render({
      canSubscribe: true,
      onSubscribe: jest.fn(),
      subscribeStatus: 'confirming',
    });

    expect(texts(root)).toContain('Confirmando tu suscripción…');
    expect(find(root, 'trial-expired-subscribe')!.props.disabled).toBe(true);
    expect(find(root, 'trial-expired-sign-out')!.props.disabled).toBe(true);
  });

  it('asks the server again from a pending purchase', () => {
    const onSubscribe = jest.fn();
    const onCheckAgain = jest.fn();
    const root = render({
      canSubscribe: true,
      onSubscribe,
      onCheckAgain,
      subscribeStatus: 'pending',
      subscribeMessage: 'Recibimos tu pago y lo estamos confirmando.',
    });

    expect(texts(root)).toContain('Revisar de nuevo');
    expect(texts(root)).toContain('Recibimos tu pago y lo estamos confirmando.');
    act(() => find(root, 'trial-expired-subscribe')!.props.onPress());

    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(onSubscribe).not.toHaveBeenCalled();
  });

  it('shows an error in the alert color', () => {
    const root = render({
      canSubscribe: true,
      onSubscribe: jest.fn(),
      subscribeStatus: 'error',
      subscribeMessage: 'La tienda no pudo completar la operación. Probá de nuevo.',
    });

    const message = root.findAll(
      (node) => node.props.testID === 'trial-expired-subscribe-message' && node.type === Text
    )[0];
    expect(message.props.children).toBe(
      'La tienda no pudo completar la operación. Probá de nuevo.'
    );
    expect([message.props.style].flat()).toContainEqual({ color: mockTheme.alert });
  });
});
