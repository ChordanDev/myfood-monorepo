/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Text, TextInput } from 'react-native';
import { loadReactNative } from '@/testing/loadReactNative';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import {
  VOICE_APPLY_RESULT,
  VOICE_APPLY_RESULT_CAPPED,
  VOICE_PREVIEW_AFTER_DRIFT,
  VOICE_PREVIEW_HIGH_CONFIDENCE,
  VOICE_PREVIEW_LOW_CONFIDENCE,
  VOICE_TRANSCRIPT_HIGH,
  VOICE_TRANSCRIPT_LOW,
} from '../mocks';
import type { VoiceApplyPayload, VoiceApplyResult, VoicePreview } from '../types';
import { InventoryVoiceSheet } from './InventoryVoiceSheet';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

// iOS keeps the children of a modal mounted while it fades out; the stock Jest mock drops
// them at once. They are kept here, as in the tests of the other inventory sheets.
jest.mock('react-native/Libraries/Modal/Modal', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

  return { __esModule: true, default: { View } };
});

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: () => ({
    inputAnimatedStyle: {},
    isKeyboardOpen: false,
    keyboardLift: 0,
  }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000000',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

// What the API answers to an apply sent without `confirmed` once the intent needs it.
const CONFIRMATION_REQUIRED = new ApiError(
  'voice_confirmation_required',
  'Confirmation required',
  422
);
const CONFIRMATION_REQUIRED_MESSAGE = 'Confirmá el ajuste antes de aplicarlo.';
const PARSE_FAILED_MESSAGE =
  'No pudimos entender lo que dijiste. Probá de nuevo o ajustalo a mano.';

function renderSheet() {
  const onPreview = jest.fn(
    (_transcript: string): Promise<VoicePreview> => Promise.resolve(VOICE_PREVIEW_HIGH_CONFIDENCE)
  );
  const onApply = jest.fn(
    (_payload: VoiceApplyPayload): Promise<VoiceApplyResult> => Promise.resolve(VOICE_APPLY_RESULT)
  );
  const onClose = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <InventoryVoiceSheet visible onPreview={onPreview} onApply={onApply} onClose={onClose} />
    );
  });

  return { root: tree!.root, onPreview, onApply, onClose };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function findButtons(root: ReactTestInstance, label: string): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.onPress === 'function' &&
      getTexts(node).includes(label)
  );
}

function findAlerts(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => node.type === Text && node.props.accessibilityRole === 'alert');
}

// Presses and lets the requests the press started settle.
async function pressAndSettle(root: ReactTestInstance, label: string) {
  const [button] = findButtons(root, label);

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  await act(async () => {
    button.props.onPress();
  });
}

// Types the transcript and asks the sheet to interpret it.
async function previewTranscript(root: ReactTestInstance, transcript: string) {
  act(() => {
    root.findByType(TextInput).props.onChangeText(transcript);
  });
  await pressAndSettle(root, 'Interpretar');
}

describe('InventoryVoiceSheet', () => {
  beforeAll(loadReactNative, 30_000);

  describe('applied amount', () => {
    it('applies a confident intent right away, without confirmed, and says what was subtracted', async () => {
      const { root, onPreview, onApply } = renderSheet();

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(onPreview).toHaveBeenCalledWith(VOICE_TRANSCRIPT_HIGH);
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith({
        transcript: VOICE_TRANSCRIPT_HIGH,
        intent: VOICE_PREVIEW_HIGH_CONFIDENCE.intent,
        confirmed: false,
        actionId: expect.any(String),
      });
      expect(getTexts(root)).toEqual(
        expect.arrayContaining(['Listo', 'Descontamos 500 g de Arroz de tu inventario.'])
      );
    });

    it('says the amount the API applied, not the previewed one, when an auto-apply is capped', async () => {
      const { root, onApply } = renderSheet();
      onApply.mockResolvedValueOnce(VOICE_APPLY_RESULT_CAPPED);

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(getTexts(root)).toContain('Descontamos 300 g de Arroz de tu inventario.');
      expect(getTexts(root).join(' ')).not.toContain('500 g');
    });

    it('says the amount the API applied, not the previewed one, when a confirmed apply is capped', async () => {
      const { root, onPreview, onApply } = renderSheet();
      onPreview.mockResolvedValueOnce(VOICE_PREVIEW_LOW_CONFIDENCE);
      onApply.mockResolvedValueOnce(VOICE_APPLY_RESULT_CAPPED);

      await previewTranscript(root, VOICE_TRANSCRIPT_LOW);

      expect(getTexts(root)).toContain('Entendimos: descontar 500 g de Arroz.');
      expect(onApply).not.toHaveBeenCalled();

      await pressAndSettle(root, 'Confirmar');

      expect(onApply).toHaveBeenCalledWith({
        transcript: VOICE_TRANSCRIPT_LOW,
        intent: VOICE_PREVIEW_LOW_CONFIDENCE.intent,
        confirmed: true,
        actionId: expect.any(String),
      });
      expect(getTexts(root)).toContain('Descontamos 300 g de Arroz de tu inventario.');
      expect(getTexts(root).join(' ')).not.toContain('500 g');
    });
  });

  describe('auto-apply the API refuses as unconfirmed', () => {
    // The fresh preview is shown for confirmation whatever its confidence: the sheet never
    // auto-applies twice.
    it.each([false, true])(
      'previews again and asks to confirm the fresh intent (fresh confirmationRequired: %s)',
      async (confirmationRequired) => {
        const freshPreview = { ...VOICE_PREVIEW_AFTER_DRIFT, confirmationRequired };
        const { root, onPreview, onApply } = renderSheet();
        onPreview
          .mockResolvedValueOnce(VOICE_PREVIEW_HIGH_CONFIDENCE)
          .mockResolvedValueOnce(freshPreview);
        onApply
          .mockRejectedValueOnce(CONFIRMATION_REQUIRED)
          .mockResolvedValueOnce(VOICE_APPLY_RESULT_CAPPED);

        await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

        expect(onPreview).toHaveBeenCalledTimes(2);
        expect(onPreview).toHaveBeenLastCalledWith(VOICE_TRANSCRIPT_HIGH);
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(getTexts(root)).toContain('Entendimos: descontar 400 g de Arroz.');
        expect(findButtons(root, 'Confirmar')).toHaveLength(1);
        expect(findAlerts(root)).toHaveLength(0);

        await pressAndSettle(root, 'Confirmar');

        expect(onPreview).toHaveBeenCalledTimes(2);
        expect(onApply).toHaveBeenCalledTimes(2);
        expect(onApply).toHaveBeenLastCalledWith({
          transcript: VOICE_TRANSCRIPT_HIGH,
          intent: freshPreview.intent,
          confirmed: true,
          actionId: expect.any(String),
        });
        expect(getTexts(root)).toEqual(
          expect.arrayContaining(['Listo', 'Descontamos 300 g de Arroz de tu inventario.'])
        );
      }
    );

    it('shows a failed second preview on the entry step, like any failed preview', async () => {
      const { root, onPreview, onApply } = renderSheet();
      onPreview
        .mockResolvedValueOnce(VOICE_PREVIEW_HIGH_CONFIDENCE)
        .mockRejectedValueOnce(new ApiError('voice_parse_failed', 'Cannot parse', 422));
      onApply.mockRejectedValueOnce(CONFIRMATION_REQUIRED);

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(onPreview).toHaveBeenCalledTimes(2);
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(findAlerts(root).map((alert) => alert.props.children)).toEqual([PARSE_FAILED_MESSAGE]);
      expect(root.findByType(TextInput).props.value).toBe(VOICE_TRANSCRIPT_HIGH);
      expect(findButtons(root, 'Interpretar')).toHaveLength(1);
      expect(findButtons(root, 'Confirmar')).toHaveLength(0);
    });

    it('does not preview again when the auto-apply fails for another reason', async () => {
      const { root, onPreview, onApply } = renderSheet();
      onApply.mockRejectedValueOnce(
        new ApiError('inventory_item_not_found', 'Inventory item not found', 404)
      );

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(findAlerts(root).map((alert) => alert.props.children)).toEqual([
        'No encontramos ese producto en tu inventario.',
      ]);
      expect(findButtons(root, 'Interpretar')).toHaveLength(1);
    });

    it('does not preview again when the API refuses an apply the User confirmed', async () => {
      const { root, onPreview, onApply } = renderSheet();
      onPreview.mockResolvedValueOnce(VOICE_PREVIEW_LOW_CONFIDENCE);
      onApply.mockRejectedValueOnce(CONFIRMATION_REQUIRED);

      await previewTranscript(root, VOICE_TRANSCRIPT_LOW);
      await pressAndSettle(root, 'Confirmar');

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(findAlerts(root).map((alert) => alert.props.children)).toEqual([
        CONFIRMATION_REQUIRED_MESSAGE,
      ]);
      expect(findButtons(root, 'Confirmar')).toHaveLength(1);
    });
  });

  describe('actionId', () => {
    const NETWORK_ERROR = new ApiError('network_error', 'Network request failed');

    function sentActionIds(onApply: jest.Mock): (string | undefined)[] {
      return onApply.mock.calls.map(([payload]: [VoiceApplyPayload]) => payload.actionId);
    }

    it('sends the same actionId when the User retries the transcript after a failed apply', async () => {
      const { root, onApply } = renderSheet();
      onApply.mockRejectedValueOnce(NETWORK_ERROR);

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);
      await pressAndSettle(root, 'Interpretar');

      const [first, retry] = sentActionIds(onApply);
      expect(first).toEqual(expect.any(String));
      expect(retry).toBe(first);
      expect(getTexts(root)).toContain('Descontamos 500 g de Arroz de tu inventario.');
    });

    it('keeps the actionId from the unconfirmed apply to the confirmed one', async () => {
      const { root, onPreview, onApply } = renderSheet();
      onPreview
        .mockResolvedValueOnce(VOICE_PREVIEW_HIGH_CONFIDENCE)
        .mockResolvedValueOnce(VOICE_PREVIEW_AFTER_DRIFT);
      onApply.mockRejectedValueOnce(CONFIRMATION_REQUIRED);

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);
      await pressAndSettle(root, 'Confirmar');

      const [unconfirmed, confirmed] = sentActionIds(onApply);
      expect(confirmed).toBe(unconfirmed);
    });

    it('sends a fresh actionId for another transcript', async () => {
      const { root, onApply } = renderSheet();
      onApply.mockRejectedValueOnce(NETWORK_ERROR);

      await previewTranscript(root, VOICE_TRANSCRIPT_HIGH);
      await previewTranscript(root, `${VOICE_TRANSCRIPT_HIGH} hoy`);

      const [first, second] = sentActionIds(onApply);
      expect(second).toEqual(expect.any(String));
      expect(second).not.toBe(first);
    });

    it('sends a fresh actionId in a sheet opened again for the same transcript', async () => {
      const first = renderSheet();
      await previewTranscript(first.root, VOICE_TRANSCRIPT_HIGH);
      const second = renderSheet();
      await previewTranscript(second.root, VOICE_TRANSCRIPT_HIGH);

      expect(sentActionIds(second.onApply)).not.toEqual(sentActionIds(first.onApply));
    });
  });
});
