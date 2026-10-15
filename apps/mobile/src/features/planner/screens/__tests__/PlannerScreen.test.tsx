import React from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { createSocketClient, type SocketClient } from '@/api/socket/socketClient';
import { createFakeSocket, type FakeSocket } from '@/api/socket/testing/fakeSocket';
import { CHAT_COMPOSER_CLEARANCE, CHAT_COMPOSER_MIN_HEIGHT } from '@/features/assistant-chat';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '../../constants';
import { PlannerScreen } from '../PlannerScreen';

const mockUseReducedMotion = jest.fn(() => false);
let mockSocketClient: SocketClient;
// No Account by default: the screen joins no topic unless a test signs one in.
let mockAccountId: string | null = null;

jest.mock('react-native', () => {
  const ReactMock = jest.requireActual('react') as typeof import('react');
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  const MockScrollView = (props: React.ComponentProps<typeof ReactNative.ScrollView>) =>
    ReactMock.createElement('RCTScrollView', props, props.children);

  MockScrollView.displayName = 'ScrollView';

  return Object.defineProperty(Object.create(ReactNative), 'ScrollView', {
    value: MockScrollView,
    enumerable: true,
  });
});

jest.mock('@/components', () => ({
  NoisyBackground: () => null,
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#ffffff',
      colorLight: '#eeeeee',
      textBlack: '#111111',
      textDark: '#222222',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('react-native-reanimated', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

jest.mock('lucide-react-native', () => ({ CircleAlert: 'CircleAlert' }));

// The header is another suite's; the other components are rendered as they are.
jest.mock('../../components', () => ({
  ...jest.requireActual('../../components/PlanningJoinNotice'),
  ...jest.requireActual('../../components/PlanningDraftPanel'),
  ...jest.requireActual('../../components/PlanningFavoritesPicker'),
  PlannerHeader: 'PlannerHeader',
}));

// The range is another suite's too: it reads the plan store and the Home barrel, which loads
// that feature's screens.
jest.mock('../../hooks/usePlanningRange', () => ({
  usePlanningRange: () => ({ range: { start: '2030-01-01', end: '2030-01-02' } }),
}));

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
}));

// The session lease and the confirm are another suite's: this one never starts a plan.
jest.mock('../../api/planningApi');
jest.mock('@/features/home/hooks/useLoadLivePlan', () => ({ loadLivePlan: jest.fn() }));

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react') as typeof import('react');

  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The real favorites store, whose server read never answers: this suite is about the scroll. The
// store's barrel also loads the auth feature, which nothing here needs.
jest.mock('@/features/favorites', () => jest.requireActual('@/features/favorites/store'));

jest.mock('@/features/favorites/api/favoritesApi', () => ({
  listFavorites: () => new Promise(() => {}),
}));

// The real barrel would load the app client, and with it the Phoenix client.
jest.mock('@/api/socket', () => ({
  ...jest.requireActual('@/api/socket/topics'),
  getSocketClient: () => mockSocketClient,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ me: mockAccountId === null ? null : { account: { id: mockAccountId } } }),
}));

// The real barrel would load the composer, which this suite's reanimated mock cannot evaluate, so
// the constants come from their own module.
jest.mock('@/features/assistant-chat', () => ({
  ...jest.requireActual('@/features/assistant-chat/constants'),
  ChatComposer: 'ChatComposer',
}));

interface ScrollHarness {
  tree: ReturnType<typeof create>;
  scrollToEnd: jest.Mock;
}

function getScrollView(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByType(ScrollView);
}

function renderHarness(reduceMotion = false): ScrollHarness {
  mockUseReducedMotion.mockReturnValue(reduceMotion);
  const scrollToEnd = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<PlannerScreen />, {
      createNodeMock: (element) => (element.type === 'RCTScrollView' ? { scrollToEnd } : null),
    });
  });

  return { tree: tree!, scrollToEnd };
}

function getComposer(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testIDPrefix: 'planner-composer' });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockUseReducedMotion.mockReturnValue(false);
  mockAccountId = null;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockUseReducedMotion.mockReset();
});

describe('PlannerScreen layout', () => {
  it('keeps the imperative ScrollView ref attached to the native node', () => {
    const { tree, scrollToEnd } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
    act(() => tree.unmount());
  });

  it('opens at the end of the list without animation when reduced motion is enabled', () => {
    const { tree, scrollToEnd } = renderHarness(true);

    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    act(() => tree.unmount());
  });

  it('does not scroll once the screen unmounts before the first frame', () => {
    const { tree, scrollToEnd } = renderHarness();

    act(() => tree.unmount());
    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  it('uses one ScrollView with keyboard clearance and stable selectors', () => {
    const { tree } = renderHarness();

    expect(tree.root.findAllByType(KeyboardAvoidingView)).toHaveLength(0);

    const scrollView = getScrollView(tree);
    expect(scrollView.props.testID).toBe('planner-conversation-list');
    // The bottom clearance already includes the safe area, so iOS must not add it a second time.
    expect(scrollView.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled');
    expect(StyleSheet.flatten(scrollView.props.style)).toEqual({
      marginTop: 21,
      flex: 1,
      paddingHorizontal: 17.5,
    });
    expect(scrollView.props.contentContainerStyle.paddingBottom).toBe(
      CHAT_COMPOSER_MIN_HEIGHT + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28
    );

    const composer = getComposer(tree);
    expect(composer.props.onHeightChange).toEqual(expect.any(Function));
    // The composer reports its height through a single prop.
    expect(composer.props).not.toHaveProperty('onRenderedHeightChange');

    act(() => {
      composer.props.onHeightChange(180);
    });
    expect(getScrollView(tree).props.contentContainerStyle.paddingBottom).toBe(
      180 + 20 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28
    );

    act(() => tree.unmount());
  });

  it('rests the composer above the tab bar under the planner testID prefix', () => {
    const { tree } = renderHarness();
    const composer = getComposer(tree);

    expect(composer.props.restingBottomGap).toBe(
      CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE
    );
    expect(composer.props.restingBottomGap).toBe(72);
    expect(composer.props.testIDPrefix).toBe('planner-composer');

    act(() => tree.unmount());
  });

  it('opens with no conversation of its own', () => {
    const { tree } = renderHarness();

    act(() => {
      jest.advanceTimersByTime(16);
    });

    // The start button is the only text: nothing pretends the assistant has spoken.
    expect(
      getScrollView(tree)
        .findAllByType(Text)
        .map((node) => node.props.children)
    ).toEqual(['Planificar 1 - 2 Enero']);
    expect(getComposer(tree).props.isThinking).toBe(false);

    act(() => tree.unmount());
  });

  it('sends nothing and shows no reply when the composer is submitted without a topic', () => {
    const { tree } = renderHarness();
    const composer = getComposer(tree);

    expect(composer.props.disabled).toBe(true);
    act(() => {
      composer.props.onChangeText('Plan dinner');
    });
    act(() => {
      getComposer(tree).props.onSubmit();
    });
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(getComposer(tree).props.value).toBe('Plan dinner');
    expect(
      getScrollView(tree)
        .findAllByType(Text)
        .map((node) => node.props.children)
    ).toEqual(['Planificar 1 - 2 Enero']);

    act(() => tree.unmount());
  });
});

describe('PlannerScreen planning topic', () => {
  let socket: FakeSocket;

  function refusal(code: string) {
    return { error: { code, message: 'refused' } };
  }

  function findJoinNotices(tree: ReturnType<typeof create>): ReactTestInstance[] {
    return tree.root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'alert'
    );
  }

  function getJoinNoticeText(tree: ReturnType<typeof create>): string {
    const [notice, ...others] = findJoinNotices(tree);

    expect(others).toEqual([]);
    return notice.findByType(Text).props.children;
  }

  beforeEach(() => {
    mockAccountId = 'account-1';
    mockSocketClient = createSocketClient({
      url: 'wss://api.example.test/socket',
      createSocket: (url, options) => {
        socket = createFakeSocket(url, options);
        return socket;
      },
      getAccessToken: async () => 'access-1',
      refreshTokens: jest.fn(),
      subscribeToAccessToken: () => () => {},
    });
  });

  it("joins the Account's planning topic and shows no notice while it joins", () => {
    const { tree } = renderHarness();

    expect(socket.channels.map((channel) => channel.topic)).toEqual(['planning:account-1']);
    expect(findJoinNotices(tree)).toEqual([]);

    act(() => tree.unmount());
    expect(socket.channels[0].hasLeft()).toBe(true);
  });

  it('shows no notice once the topic is joined', () => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyOk());

    expect(findJoinNotices(tree)).toEqual([]);
    act(() => tree.unmount());
  });

  it.each([
    { code: 'trial_expired', reason: 'Tu período de prueba terminó.' },
    { code: 'forbidden', reason: 'No tenés permiso para hacer esto.' },
  ])('shows the reason of a join refused as $code', ({ code, reason }) => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyError(refusal(code)));

    expect(getJoinNoticeText(tree)).toBe(reason);
    act(() => tree.unmount());
  });

  it('keeps the composer in place, unable to send, under a refused join', () => {
    const { tree } = renderHarness();

    act(() => socket.channels[0].replyError(refusal('trial_expired')));

    expect(getComposer(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it.each(['session_expired', 'session_lost_lock'])(
    'tells the user the session is over on %s',
    (event) => {
      const { tree } = renderHarness();
      act(() => socket.channels[0].replyOk());

      act(() => socket.channels[0].serverPush(event, {}));

      expect(getJoinNoticeText(tree)).toBe(
        'Esta sesión de planificación terminó. Empezá una nueva para seguir.'
      );
      act(() => tree.unmount());
    }
  );
});
