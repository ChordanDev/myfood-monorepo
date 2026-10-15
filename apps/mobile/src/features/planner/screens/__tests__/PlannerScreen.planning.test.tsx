import React from 'react';
import { AppState, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { createSocketClient, type SocketClient } from '@/api/socket/socketClient';
import {
  createFakeSocket,
  type FakeChannel,
  type FakePush,
  type FakeSocket,
} from '@/api/socket/testing/fakeSocket';
import confirmProposalReply from '../../fixtures/confirmProposalReply.json';
import generationError from '../../fixtures/generationError.json';
import generationStarted from '../../fixtures/generationStarted.json';
import planningInvalidRangeError from '../../fixtures/planningInvalidRangeError.json';
import planningMessage from '../../fixtures/planningMessage.json';
import planningRangeLockedError from '../../fixtures/planningRangeLockedError.json';
import planningSlotOccupiedError from '../../fixtures/planningSlotOccupiedError.json';
import proposalReady from '../../fixtures/proposalReady.json';
import sessionCommitted from '../../fixtures/sessionCommitted.json';
import sessionStarted from '../../fixtures/sessionStarted.json';
import startPlanningReply from '../../fixtures/startPlanningReply.json';
import { listFavorites } from '@/features/favorites/api/favoritesApi';
import { useFavoritesStore } from '@/features/favorites/store';
import type { FavoriteSummary } from '@/features/favorites';
import { confirmProposal, rejectProposal, renewPlanningSession } from '../../api/planningApi';
import { PlannerScreen } from '../PlannerScreen';

// The server payloads are the fixtures the API channel tests record, so a change of the API that
// the app does not follow fails here instead of on a device.
//
// requestId of generationStarted.json: the screen correlates the events with the request it sent.
jest.mock('@/services/requestId', () => ({ newRequestId: () => 'req_fixture_1' }));

let mockSocketClient: SocketClient;

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

jest.mock('@/components', () => ({ NoisyBackground: () => null }));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#ffffff',
      colorLight: '#eeeeee',
      textBlack: '#111111',
      textDark: '#222222',
      colorBlack: '#050505',
      colorDark: '#333333',
      textLight: '#fafafa',
      primaryAccent: '#ff6600',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 20, left: 0 }),
}));

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));

jest.mock('lucide-react-native', () => ({ CircleAlert: 'CircleAlert' }));

jest.mock('../../components', () => ({
  ...jest.requireActual('../../components/PlanningJoinNotice'),
  ...jest.requireActual('../../components/PlanningDraftPanel'),
  ...jest.requireActual('../../components/PlanningFavoritesPicker'),
  PlannerHeader: 'PlannerHeader',
}));

let mockRange: { start: string | null; end: string | null } = {
  start: '2030-01-01',
  end: '2030-01-02',
};

jest.mock('../../hooks/usePlanningRange', () => ({
  usePlanningRange: () => ({ range: mockRange }),
}));

// The pure modules behind the Home barrel: the barrel itself loads its screens.
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/home/constants/calendar'),
  ...jest.requireActual('@/features/home/utils/calendarDate'),
}));

const mockLoadLivePlan = jest.fn();

// The read of the calendar the screen asks for after a commit.
jest.mock('@/features/home/hooks/useLoadLivePlan', () => ({
  loadLivePlan: () => mockLoadLivePlan(),
}));

jest.mock('../../api/planningApi');

// The screen is in focus for the whole suite.
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react') as typeof import('react');

  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
  };
});

jest.mock('@/api/socket', () => ({
  ...jest.requireActual('@/api/socket/topics'),
  getSocketClient: () => mockSocketClient,
}));

jest.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ me: { account: { id: 'account-1' } } }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The real favorites store, fed by the list this suite hands it instead of the network. Its barrel
// also loads the auth feature, which nothing here needs.
jest.mock('@/features/favorites', () => jest.requireActual('@/features/favorites/store'));

jest.mock('@/features/favorites/api/favoritesApi', () => ({ listFavorites: jest.fn() }));

jest.mock('@/features/assistant-chat', () => ({
  ...jest.requireActual('@/features/assistant-chat/constants'),
  ChatComposer: 'ChatComposer',
}));

const mockListFavorites = jest.mocked(listFavorites);
const mockConfirmProposal = jest.mocked(confirmProposal);
const mockRejectProposal = jest.mocked(rejectProposal);
const mockRenewPlanningSession = jest.mocked(renewPlanningSession);

// The confirm of the proposal the fixtures generate, in the session they run in.
const CONFIRMED = {
  ...confirmProposalReply,
  proposalId: proposalReady.proposalId,
  sessionId: generationStarted.sessionId,
  status: 'committed' as const,
  scheduledMealsCount: 4,
};

function favorite(recipeId: string, name: string): FavoriteSummary {
  return { recipeId, name, mainIngredients: [], durationMinutes: null };
}

const FAVORITES = [favorite('recipe-1', 'Lentejas'), favorite('recipe-2', 'Milanesa')];

let socket: FakeSocket;
let tree: ReturnType<typeof create>;

function channel(): FakeChannel {
  return socket.channels[0];
}

function lastPush(): FakePush {
  return channel().pushes[channel().pushes.length - 1];
}

function renderJoined(): void {
  act(() => {
    tree = create(<PlannerScreen />, {
      createNodeMock: (element) =>
        element.type === 'RCTScrollView' ? { scrollTo: jest.fn(), scrollToEnd: jest.fn() } : null,
    });
  });
  act(() => channel().replyOk());
}

// The User has `favorites` on the server and the planner reads them when it opens.
async function renderJoinedWithFavorites(favorites: FavoriteSummary[]): Promise<void> {
  mockListFavorites.mockResolvedValue(favorites);
  await act(async () => {
    tree = create(<PlannerScreen />, {
      createNodeMock: (element) =>
        element.type === 'RCTScrollView' ? { scrollTo: jest.fn(), scrollToEnd: jest.fn() } : null,
    });
  });
  act(() => channel().replyOk());
}

function byTestId(testID: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.props.testID === testID)[0];
}

function press(testID: string): void {
  const button = byTestId(testID);
  if (button === undefined) throw new Error(`No ${testID} on screen`);
  act(() => button.props.onPress());
}

function textsOf(testID: string): string[] {
  const node = byTestId(testID);
  if (node === undefined) throw new Error(`No ${testID} on screen`);
  return node.findAllByType(Text).map((text) => [text.props.children].flat().join(''));
}

function type(request: string): void {
  act(() =>
    tree.root.findByProps({ testIDPrefix: 'planner-composer' }).props.onChangeText(request)
  );
}

function composer(): ReactTestInstance {
  return tree.root.findByProps({ testIDPrefix: 'planner-composer' });
}

function composerValue(): string {
  return composer().props.value;
}

function submitComposer(): void {
  act(() => composer().props.onSubmit());
}

function emit(event: string, payload: unknown): void {
  act(() => channel().emit(event, payload));
}

// The server accepts the push and the generation runs up to the point `emitRun` plays.
async function replyOk(): Promise<void> {
  await act(async () => lastPush().replyOk(startPlanningReply));
}

async function replyError(envelope: unknown): Promise<void> {
  await act(async () => lastPush().replyError(envelope));
}

function emitGenerationStarted(): void {
  emit('session_started', sessionStarted);
  emit('generation_started', generationStarted);
}

function emitProposal(): void {
  emit('proposal_ready', proposalReady);
  emit('planning_message', planningMessage);
}

describe('PlannerScreen first proposal', () => {
  beforeEach(() => {
    // An emptied store, and a server that has not answered yet unless a test says so.
    useFavoritesStore.getState().clear();
    mockListFavorites.mockReturnValue(new Promise(() => {}));
    mockRange = { start: '2030-01-01', end: '2030-01-02' };
    // The app is in the foreground: the session of a draft is renewed.
    (AppState as { currentState: string }).currentState = 'active';
    mockLoadLivePlan.mockReset().mockResolvedValue(undefined);
    mockConfirmProposal.mockReset().mockResolvedValue(CONFIRMED);
    mockRejectProposal.mockReset().mockResolvedValue(undefined);
    mockRenewPlanningSession.mockReset().mockResolvedValue({
      sessionId: generationStarted.sessionId,
      leaseExpiresAt: '2030-01-01T12:02:00Z',
    });
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

  afterEach(() => {
    act(() => tree.unmount());
  });

  it('waits for the topic before it offers to start', () => {
    act(() => {
      tree = create(<PlannerScreen />, {
        createNodeMock: (element) =>
          element.type === 'RCTScrollView' ? { scrollTo: jest.fn(), scrollToEnd: jest.fn() } : null,
      });
    });

    expect(byTestId('planner-start')?.props.disabled).toBe(true);
    expect(composer().props.disabled).toBe(true);

    act(() => channel().replyOk());

    expect(byTestId('planner-start')?.props.disabled).toBe(false);
    expect(composer().props.disabled).toBe(false);
  });

  it('names the range it will plan on the start button', () => {
    renderJoined();

    expect(textsOf('planner-start')).toEqual(['Planificar 1 - 2 Enero']);
  });

  it('names the one day it will plan when the range has only a start', () => {
    mockRange = { start: '2030-01-03', end: null };
    renderJoined();

    expect(textsOf('planner-start')).toEqual(['Planificar 3 Enero']);

    press('planner-start');

    expect(lastPush().payload).toMatchObject({ rangeFrom: '2030-01-03', rangeTo: '2030-01-03' });
  });

  it('starts planning with the picked range and the typed request, and clears the request once accepted', async () => {
    renderJoined();
    type('  sin carne  ');

    press('planner-start');

    expect(lastPush().event).toBe('start_planning');
    expect(lastPush().payload).toEqual({
      rangeFrom: '2030-01-01',
      rangeTo: '2030-01-02',
      requestId: 'req_fixture_1',
      request: 'sin carne',
    });
    expect(composerValue()).toBe('  sin carne  ');

    await replyOk();

    expect(composerValue()).toBe('');
  });

  it('keeps the typed request when the server refuses the start', async () => {
    renderJoined();
    type('sin carne');
    press('planner-start');

    await replyError(planningRangeLockedError);

    expect(composerValue()).toBe('sin carne');
  });

  it('keeps what the User typed after the tap when the start is accepted', async () => {
    renderJoined();
    type('sin carne');
    press('planner-start');
    type('sin carne y sin lacteos');

    await replyOk();

    expect(composerValue()).toBe('sin carne y sin lacteos');
  });

  it('refuses a request over 1000 characters without pushing, and keeps it', () => {
    renderJoined();
    type('x'.repeat(1001));

    press('planner-start');

    expect(channel().pushes).toHaveLength(0);
    expect(textsOf('planner-failure')).toEqual(['Los datos enviados no son válidos.']);
    expect(composerValue()).toBe('x'.repeat(1001));
  });

  it('sends no request when nothing is typed', () => {
    renderJoined();

    press('planner-start');

    expect(lastPush().payload).not.toHaveProperty('request');
  });

  describe('the composer', () => {
    it('starts planning with its text as the request, and sends nothing else', async () => {
      renderJoined();
      type('  sin carne  ');

      submitComposer();

      expect(channel().pushes.map((push) => push.event)).toEqual(['start_planning']);
      expect(lastPush().payload).toEqual({
        rangeFrom: '2030-01-01',
        rangeTo: '2030-01-02',
        requestId: 'req_fixture_1',
        request: 'sin carne',
      });

      await replyOk();

      expect(composerValue()).toBe('');
      expect(channel().pushes.map((push) => push.event)).toEqual(['start_planning']);
    });

    it('shows no reply of its own after it sends', async () => {
      jest.useFakeTimers();
      try {
        renderJoined();
        type('sin carne');

        submitComposer();
        await replyOk();
        act(() => {
          jest.advanceTimersByTime(60_000);
        });

        // Only the progress of the generation: no message is made up while the server works.
        const conversation = tree.root.findByProps({ testID: 'planner-conversation-list' });
        expect(conversation.findAllByType(Text).map((text) => text.props.children)).toEqual([
          'Armando tu menú…',
          'Cancelar',
        ]);
        expect(composer().props.isThinking).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('cannot send while a plan is running', async () => {
      renderJoined();
      type('sin carne');
      submitComposer();

      expect(composer().props.disabled).toBe(true);

      await replyOk();
      emitGenerationStarted();
      emitProposal();
      type('sin lacteos');
      submitComposer();

      expect(byTestId('planner-proposal')).toBeDefined();
      expect(composer().props.disabled).toBe(true);
      expect(channel().pushes.map((push) => push.event)).toEqual(['start_planning']);
    });

    it('sends again once the session is cancelled', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();
      press('planner-cancel');

      expect(composer().props.disabled).toBe(false);

      type('sin carne');
      submitComposer();

      expect(lastPush().event).toBe('start_planning');
      expect(lastPush().payload).toMatchObject({ request: 'sin carne' });
    });
  });

  describe('the favorites preselect step', () => {
    it('lists the favorites the server has, as unchecked checkboxes', async () => {
      await renderJoinedWithFavorites(FAVORITES);

      expect(textsOf('planner-favorite-recipe-1')).toEqual(['Lentejas']);
      expect(textsOf('planner-favorite-recipe-2')).toEqual(['Milanesa']);
      for (const id of ['recipe-1', 'recipe-2']) {
        expect(byTestId(`planner-favorite-${id}`)?.props).toMatchObject({
          accessibilityRole: 'checkbox',
          accessibilityState: { checked: false },
        });
      }
    });

    it('is not shown when the User has no favorites', async () => {
      await renderJoinedWithFavorites([]);

      expect(byTestId('planner-favorites')).toBeUndefined();
      expect(byTestId('planner-start')).toBeDefined();
    });

    it('checks a favorite when tapped and unchecks it when tapped again', async () => {
      await renderJoinedWithFavorites(FAVORITES);

      press('planner-favorite-recipe-1');
      expect(byTestId('planner-favorite-recipe-1')?.props.accessibilityState).toEqual({
        checked: true,
      });
      expect(byTestId('planner-favorite-recipe-2')?.props.accessibilityState).toEqual({
        checked: false,
      });

      press('planner-favorite-recipe-1');
      expect(byTestId('planner-favorite-recipe-1')?.props.accessibilityState).toEqual({
        checked: false,
      });
    });

    it('sends the selected favorites with the start, next to the range and the request', async () => {
      await renderJoinedWithFavorites(FAVORITES);
      type('sin carne');
      press('planner-favorite-recipe-2');
      press('planner-favorite-recipe-1');

      press('planner-start');

      expect(lastPush().event).toBe('start_planning');
      expect(lastPush().payload).toEqual({
        rangeFrom: '2030-01-01',
        rangeTo: '2030-01-02',
        requestId: 'req_fixture_1',
        request: 'sin carne',
        favoriteRecipeIds: ['recipe-2', 'recipe-1'],
      });
    });

    it('sends no favoriteRecipeIds when none is selected, or after the selection is undone', async () => {
      await renderJoinedWithFavorites(FAVORITES);
      press('planner-favorite-recipe-1');
      press('planner-favorite-recipe-1');

      press('planner-start');

      expect(lastPush().payload).not.toHaveProperty('favoriteRecipeIds');
    });

    it('does not send a favorite that was removed before the start', async () => {
      await renderJoinedWithFavorites(FAVORITES);
      press('planner-favorite-recipe-1');
      press('planner-favorite-recipe-2');

      // Removed from the favorites screen while the planner stays open.
      act(() => {
        useFavoritesStore.setState({ favorites: [FAVORITES[1]] });
      });
      expect(byTestId('planner-favorite-recipe-1')).toBeUndefined();

      press('planner-start');

      expect(lastPush().payload).toMatchObject({ favoriteRecipeIds: ['recipe-2'] });
    });

    it('goes away while the plan is generating', async () => {
      await renderJoinedWithFavorites(FAVORITES);

      press('planner-start');

      expect(byTestId('planner-favorites')).toBeUndefined();
    });

    it('sends the same favorites again from the retry button', async () => {
      await renderJoinedWithFavorites(FAVORITES);
      press('planner-favorite-recipe-2');
      press('planner-start');
      await replyError(planningRangeLockedError);

      press('planner-retry');

      expect(lastPush().payload).toMatchObject({ favoriteRecipeIds: ['recipe-2'] });
    });
  });

  it('shows progress from the tap until the proposal arrives', async () => {
    renderJoined();

    press('planner-start');
    expect(byTestId('planner-progress')).toBeDefined();
    expect(byTestId('planner-start')).toBeUndefined();

    await replyOk();
    emitGenerationStarted();

    expect(byTestId('planner-progress')).toBeDefined();
    expect(byTestId('planner-proposal')).toBeUndefined();
  });

  it('renders the proposal as day cards with the assistant message and the estimated cost', async () => {
    renderJoined();
    press('planner-start');
    await replyOk();
    emitGenerationStarted();

    emitProposal();

    expect(byTestId('planner-progress')).toBeUndefined();
    expect(textsOf('planner-proposal-day-2030-01-01')).toEqual([
      'Martes 1 Enero',
      '$13',
      'Desayuno',
      'Oatmeal',
      '500 kcal · P 30 g · C – g',
      'Almuerzo',
      'Chicken rice',
      '500 kcal · P 30 g · C 60 g',
    ]);
    expect(textsOf('planner-proposal-day-2030-01-02')).toEqual([
      'Miércoles 2 Enero',
      '$7',
      'Cena',
      'Lentil stew',
      '500 kcal · P 12.5 g · C 60 g',
    ]);
    expect(textsOf('planner-proposal')).toContain('Acá tenés tu menú para 2 días: 3 comidas.');
    expect(textsOf('planner-proposal')).not.toContain(planningMessage.text);
    expect(textsOf('planner-proposal-cost')).toEqual(['Costo estimado: $20']);
    // The cost shows once, on its own line, and not again in the assistant message.
    expect(
      textsOf('planner-proposal').filter((text) => /costo|cost|\$20|19[.,]50/i.test(text))
    ).toEqual(['Costo estimado: $20']);
  });

  it('shows the proposal before the assistant message, which follows it', async () => {
    renderJoined();
    press('planner-start');
    await replyOk();
    emitGenerationStarted();

    emit('proposal_ready', proposalReady);

    expect(byTestId('planner-proposal-day-2030-01-01')).toBeDefined();
    expect(textsOf('planner-proposal')).not.toContain('Acá tenés tu menú para 2 días: 3 comidas.');

    emit('planning_message', planningMessage);

    expect(textsOf('planner-proposal')).toContain('Acá tenés tu menú para 2 días: 3 comidas.');
  });

  it('ignores an error or a message that does not match the frozen shape, and keeps waiting', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderJoined();
    press('planner-start');
    await replyOk();
    emitGenerationStarted();

    emit('generation_error', { reason: 42 });
    emit('planning_message', null);

    expect(byTestId('planner-progress')).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(2);

    emitProposal();
    expect(byTestId('planner-proposal')).toBeDefined();
    warn.mockRestore();
  });

  describe('a proposal the app cannot read', () => {
    // The proposal of the fixtures with its first meal patched, as a drifted engine or a bad row
    // would send it.
    function withFirstMeal(patch: Record<string, unknown>) {
      const [first, ...rest] = proposalReady.days;
      const [meal, ...meals] = first.meals;
      return {
        ...proposalReady,
        days: [{ ...first, meals: [{ ...meal, ...patch }, ...meals] }, ...rest],
      };
    }

    let warn: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => warn.mockRestore());

    it.each([
      ['a meal with no recipe name', withFirstMeal({ recipeName: null })],
      ['a slot outside the four', withFirstMeal({ slot: 'brunch' })],
    ])('fails the generation on %s, with a retry button', async (_case, payload) => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('proposal_ready', payload);

      expect(byTestId('planner-progress')).toBeUndefined();
      expect(textsOf('planner-failure')).toEqual(['No pudimos armar tu menú. Probá de nuevo.']);
      expect(byTestId('planner-retry')).toBeDefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fails on one whose run cannot be read either', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('proposal_ready', { runId: 42 });

      expect(byTestId('planner-failure')).toBeDefined();
    });

    it('ignores one of a run the screen did not start', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('proposal_ready', {
        ...withFirstMeal({ slot: 'brunch' }),
        runId: 'a-run-of-another-member',
      });

      expect(byTestId('planner-progress')).toBeDefined();
    });

    it('retries after it, cancelling the session of the generation first', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();
      emit('proposal_ready', withFirstMeal({ slot: 'brunch' }));

      press('planner-retry');

      expect(channel().pushes.map((push) => push.event)).toEqual([
        'start_planning',
        'cancel_planning',
      ]);
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });
    });
  });

  describe('a generation that takes too long', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    async function startGeneration(): Promise<void> {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();
    }

    function wait(ms: number): void {
      act(() => {
        jest.advanceTimersByTime(ms);
      });
    }

    it('keeps waiting for 90 seconds from the tap, then fails with a retry button', async () => {
      await startGeneration();

      wait(89_999);
      expect(byTestId('planner-progress')).toBeDefined();

      wait(1);
      expect(byTestId('planner-progress')).toBeUndefined();
      expect(textsOf('planner-failure')).toEqual(['No pudimos armar tu menú. Probá de nuevo.']);
      expect(byTestId('planner-retry')).toBeDefined();
    });

    it('shows a proposal that arrives after the limit instead of the failure', async () => {
      await startGeneration();
      wait(90_000);

      emitProposal();

      expect(byTestId('planner-failure')).toBeUndefined();
      expect(byTestId('planner-proposal-day-2030-01-01')).toBeDefined();
    });

    it('retries after the limit, cancelling the session of the generation first', async () => {
      await startGeneration();
      wait(90_000);

      press('planner-retry');

      expect(channel().pushes.map((push) => push.event)).toEqual([
        'start_planning',
        'cancel_planning',
      ]);
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });
      expect(byTestId('planner-progress')).toBeDefined();
    });

    it('starts counting again from the tap of a retry', async () => {
      await startGeneration();
      wait(90_000);
      press('planner-retry');
      await act(async () => lastPush().replyOk({ sessionId: 's', status: 'cancelled' }));
      await replyOk();

      wait(89_999);

      expect(byTestId('planner-progress')).toBeDefined();
    });
  });

  describe('cancelling a generation', () => {
    it('offers to cancel from the tap', () => {
      renderJoined();

      press('planner-start');

      expect(byTestId('planner-progress')).toBeDefined();
      expect(textsOf('planner-cancel')).toEqual(['Cancelar']);
    });

    it('cancels the session of the generation and offers to start again', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      press('planner-cancel');

      expect(lastPush().event).toBe('cancel_planning');
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });
      expect(byTestId('planner-progress')).toBeUndefined();
      expect(byTestId('planner-start')).toBeDefined();

      // The generation it left behind no longer moves the draft.
      emitProposal();
      expect(byTestId('planner-proposal')).toBeUndefined();
    });

    it('cancels the session as soon as it is known when cancelled before it', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();

      press('planner-cancel');

      expect(channel().pushes.map((push) => push.event)).toEqual(['start_planning']);
      expect(byTestId('planner-start')).toBeDefined();

      emitGenerationStarted();

      expect(channel().pushes.map((push) => push.event)).toEqual([
        'start_planning',
        'cancel_planning',
      ]);
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });
      expect(byTestId('planner-start')).toBeDefined();
    });
  });

  describe('a start the server refuses', () => {
    it('shows the text of planning_invalid_range with a retry button', async () => {
      renderJoined();
      press('planner-start');

      await replyError(planningInvalidRangeError);

      expect(byTestId('planner-progress')).toBeUndefined();
      expect(textsOf('planner-failure')).toEqual([
        'Elegí entre 1 y 7 días, empezando hoy o más adelante.',
      ]);
      expect(byTestId('planner-retry')).toBeDefined();
    });

    it('names the owner of a range that another member holds', async () => {
      renderJoined();
      press('planner-start');

      await replyError(planningRangeLockedError);

      expect(textsOf('planner-failure')).toEqual([
        'Ana Peer ya tiene una planificación en curso para esas fechas.',
      ]);
    });

    it('shows the plain text of a locked range when the reply names no owner', async () => {
      renderJoined();
      press('planner-start');

      await replyError({
        error: { code: 'planning_range_locked', message: planningRangeLockedError.error.message },
      });

      expect(textsOf('planner-failure')).toEqual([
        'Esas fechas ya están en una planificación en curso.',
      ]);
    });

    it('keeps waiting when the server is slow to answer, and shows the proposal that follows', async () => {
      renderJoined();
      press('planner-start');

      await act(async () => lastPush().timeout());

      expect(byTestId('planner-progress')).toBeDefined();
      expect(byTestId('planner-failure')).toBeUndefined();

      emitGenerationStarted();
      emitProposal();

      expect(byTestId('planner-proposal')).toBeDefined();
    });
  });

  describe('a generation that fails', () => {
    it('shows the failure and a retry button', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('generation_error', generationError);

      expect(byTestId('planner-progress')).toBeUndefined();
      expect(textsOf('planner-failure')).toEqual(['No pudimos armar tu menú. Probá de nuevo.']);
      expect(byTestId('planner-retry')).toBeDefined();
    });

    it('fails on a generation_error that arrives before generation_started', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();

      emit('generation_error', generationError);
      expect(byTestId('planner-progress')).toBeDefined();

      emit('generation_started', generationStarted);

      expect(byTestId('planner-failure')).toBeDefined();
    });

    it('fails on an error that names no run and no request', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('generation_error', { ...generationError, runId: null, requestId: null });

      expect(byTestId('planner-progress')).toBeUndefined();
      expect(byTestId('planner-failure')).toBeDefined();
    });

    it('fails when the session of the generation is cancelled', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('session_cancelled', { sessionId: generationStarted.sessionId });

      expect(byTestId('planner-progress')).toBeUndefined();
      expect(byTestId('planner-failure')).toBeDefined();
    });

    it('ignores the error of a run the screen did not start', async () => {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();

      emit('generation_error', { ...generationError, runId: 'a-run-of-another-member' });

      expect(byTestId('planner-progress')).toBeDefined();
    });

    it('starts again from the retry button with the same range and request, and shows the proposal', async () => {
      renderJoined();
      type('sin carne');
      press('planner-start');
      await replyOk();
      emitGenerationStarted();
      emit('generation_error', generationError);

      press('planner-retry');

      // The session of the failed generation still holds the range: it is cancelled first.
      expect(channel().pushes.map((push) => push.event)).toEqual([
        'start_planning',
        'cancel_planning',
      ]);
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });
      expect(byTestId('planner-progress')).toBeDefined();
      expect(byTestId('planner-failure')).toBeUndefined();

      await act(async () => lastPush().replyOk({ sessionId: 's', status: 'cancelled' }));

      expect(channel().pushes).toHaveLength(3);
      expect(lastPush().event).toBe('start_planning');
      expect(lastPush().payload).toEqual(channel().pushes[0].payload);

      await replyOk();
      emitGenerationStarted();
      emitProposal();

      expect(byTestId('planner-proposal-day-2030-01-01')).toBeDefined();
      expect(byTestId('planner-failure')).toBeUndefined();
    });

    it('retries after a refused start too', async () => {
      renderJoined();
      press('planner-start');
      await replyError(planningRangeLockedError);

      press('planner-retry');
      await replyOk();
      emitGenerationStarted();
      emitProposal();

      // A refused start left no session behind: nothing to cancel.
      expect(channel().pushes.map((push) => push.event)).toEqual([
        'start_planning',
        'start_planning',
      ]);
      expect(byTestId('planner-proposal')).toBeDefined();
    });
  });
  describe('a proposal to confirm, reject or cancel', () => {
    async function renderProposal(): Promise<void> {
      renderJoined();
      press('planner-start');
      await replyOk();
      emitGenerationStarted();
      emitProposal();
    }

    async function pressAsync(testID: string): Promise<void> {
      const button = byTestId(testID);
      if (button === undefined) throw new Error(`No ${testID} on screen`);
      await act(async () => button.props.onPress());
    }

    it('confirms over HTTP, says how many meals it scheduled and refreshes the calendar', async () => {
      await renderProposal();

      await pressAsync('planner-confirm');

      expect(mockConfirmProposal).toHaveBeenCalledWith({
        proposalId: proposalReady.proposalId,
        sessionId: generationStarted.sessionId,
      });
      expect(textsOf('planner-committed')).toEqual([
        'Listo: agendamos 4 comidas en tu calendario y actualizamos tu lista de compras.',
      ]);
      expect(byTestId('planner-proposal')).toBeUndefined();
      expect(mockLoadLivePlan).toHaveBeenCalledTimes(1);
    });

    it('commits on session_committed of its session too, as when the reply was lost', async () => {
      mockConfirmProposal.mockReturnValue(new Promise(() => {}));
      await renderProposal();
      press('planner-confirm');

      emit('session_committed', {
        ...sessionCommitted,
        proposalId: proposalReady.proposalId,
        sessionId: generationStarted.sessionId,
      });

      expect(textsOf('planner-committed')).toEqual([
        'Listo: agendamos 1 comida en tu calendario y actualizamos tu lista de compras.',
      ]);
      expect(mockLoadLivePlan).toHaveBeenCalledTimes(1);
    });

    it('keeps the proposal and says why when the confirm is refused', async () => {
      mockConfirmProposal.mockRejectedValue(
        new ApiError('planning_proposal_not_pending', 'not pending', 409)
      );
      await renderProposal();

      await pressAsync('planner-confirm');

      expect(textsOf('planner-action-error')).toEqual([
        'Esta propuesta ya no está pendiente. Pedí una nueva.',
      ]);
      expect(byTestId('planner-proposal')).toBeDefined();
      expect(mockLoadLivePlan).not.toHaveBeenCalled();
      // A refusal is an answer: the User may still leave the proposal.
      expect(byTestId('planner-reject')?.props.disabled).toBe(false);
      expect(byTestId('planner-cancel')?.props.disabled).toBe(false);
    });

    // Jorge review of PR #278: a confirm that ends without an answer may still commit on the
    // server, so leaving the proposal could reject a menu that is already scheduled. Only a new
    // confirm, which answers the result of the first one, is offered.
    it.each([
      ['unknown_error', 500],
      ['network_error', 0],
      ['timeout', 0],
    ] as const)(
      'offers only to confirm again after a confirm that ends in %s',
      async (code, status) => {
        mockConfirmProposal.mockRejectedValueOnce(new ApiError(code, 'no answer', status));
        await renderProposal();

        await pressAsync('planner-confirm');

        expect(textsOf('planner-action-error')).toEqual([
          'No sabemos si tu menú se guardó. Tocá Confirmar menú de nuevo para comprobarlo.',
        ]);
        expect(byTestId('planner-reject')?.props.disabled).toBe(true);
        expect(byTestId('planner-cancel')?.props.disabled).toBe(true);
        expect(byTestId('planner-confirm')?.props.disabled).toBe(false);

        await pressAsync('planner-confirm');

        expect(mockConfirmProposal).toHaveBeenCalledTimes(2);
        expect(textsOf('planner-committed')).toEqual([
          'Listo: agendamos 4 comidas en tu calendario y actualizamos tu lista de compras.',
        ]);
      }
    );

    it('lets the User leave the proposal once a new confirm is refused with an answer', async () => {
      mockConfirmProposal
        .mockRejectedValueOnce(new ApiError('unknown_error', 'no answer', 500))
        .mockRejectedValueOnce(new ApiError('lost_lock', 'lost', 409));
      await renderProposal();

      await pressAsync('planner-confirm');
      await pressAsync('planner-confirm');

      expect(byTestId('planner-reject')?.props.disabled).toBe(false);
      expect(byTestId('planner-cancel')?.props.disabled).toBe(false);
    });

    it('disables the actions while the confirm is on its way', async () => {
      mockConfirmProposal.mockReturnValue(new Promise(() => {}));
      await renderProposal();

      press('planner-confirm');

      for (const id of ['planner-confirm', 'planner-reject', 'planner-cancel']) {
        expect(byTestId(id)?.props.disabled).toBe(true);
      }
      press('planner-confirm');
      expect(mockConfirmProposal).toHaveBeenCalledTimes(1);
    });

    it('rejects the proposal and asks for another one with the same range and request', async () => {
      await renderProposal();
      const firstStart = channel().pushes[0].payload;

      await pressAsync('planner-reject');

      expect(mockRejectProposal).toHaveBeenCalledWith(proposalReady.proposalId);
      expect(lastPush().event).toBe('cancel_planning');
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });

      await act(async () => lastPush().replyOk({ sessionId: 's', status: 'cancelled' }));

      expect(lastPush().event).toBe('start_planning');
      expect(lastPush().payload).toEqual(firstStart);
      expect(byTestId('planner-progress')).toBeDefined();
    });

    it('cancels the session and offers to start again', async () => {
      await renderProposal();

      press('planner-cancel');

      expect(lastPush().event).toBe('cancel_planning');
      expect(lastPush().payload).toEqual({ sessionId: generationStarted.sessionId });

      await act(async () => lastPush().replyOk({ sessionId: 's', status: 'cancelled' }));

      expect(byTestId('planner-proposal')).toBeUndefined();
      expect(byTestId('planner-start')).toBeDefined();
      expect(mockConfirmProposal).not.toHaveBeenCalled();
    });

    it('keeps the session alive while the proposal is open', async () => {
      await renderProposal();

      expect(mockRenewPlanningSession).toHaveBeenCalledWith(generationStarted.sessionId);
    });

    it('says the session is over when its lease is lost', async () => {
      mockRenewPlanningSession.mockRejectedValue(new ApiError('lost_lock', 'lost', 409));
      await renderProposal();
      await act(async () => undefined);

      expect(textsOf('planner-join-notice')).toEqual([
        'Esta sesión de planificación terminó. Empezá una nueva para seguir.',
      ]);
    });
  });

  it('says the range already has meals when the server refuses it as occupied', async () => {
    renderJoined();
    press('planner-start');

    await replyError(planningSlotOccupiedError);

    expect(textsOf('planner-failure')).toEqual([
      'Ya tenés comidas planificadas en esos días. Elegí días libres.',
    ]);
  });
});
