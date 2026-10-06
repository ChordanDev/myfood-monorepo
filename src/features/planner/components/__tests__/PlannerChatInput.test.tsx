/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import {
  CUSTOM_TAB_BAR_CONTENT_HEIGHT,
  PLANNER_CHAT_INPUT_CLEARANCE,
  PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT,
  PLANNER_CHAT_INPUT_MAX_HEIGHT,
  PLANNER_CHAT_INPUT_MAX_LINES,
  PLANNER_CHAT_INPUT_MIN_HEIGHT,
  PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
  PLANNER_CHAT_INPUT_VERTICAL_INSET,
} from '../../constants';
import { PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y, PlannerChatInput } from '../PlannerChatInput';

const mockWithTiming = jest.fn((value: number, config?: unknown, callback?: unknown) => value);
const mockUseReducedMotion = jest.fn(() => true);
let mockFontScale = 1;
const originalPlatformOS = Platform.OS;

jest.mock('@/hooks/useKeyboardAnimation', () => ({
  useKeyboardAnimation: jest.fn(() => ({
    inputAnimatedStyle: { transform: [{ translateY: -120 }] },
    isKeyboardOpen: true,
  })),
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

// The preset reports a font scale of 2; pin it so the fallback line height is deterministic.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');

  const createSharedValue = (initialValue: number) => {
    const sharedValue = {
      value: initialValue,
      get: () => sharedValue.value,
      set: (nextValue: number) => {
        sharedValue.value = nextValue;
      },
    };

    return sharedValue;
  };

  return {
    __esModule: true,
    default: { View },
    cancelAnimation: jest.fn(),
    Easing: {
      cubic: jest.fn(),
      linear: jest.fn(),
      out: (easing: unknown) => easing,
    },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: (
      value: number,
      [inputStart, inputEnd]: [number, number],
      [outputStart, outputEnd]: [number, number]
    ) => {
      const progress = Math.min(1, Math.max(0, (value - inputStart) / (inputEnd - inputStart)));
      return outputStart + (outputEnd - outputStart) * progress;
    },
    // Shared values are written from effects and handlers, after render. Resolving each key on
    // read mirrors the UI thread applying them without another React render.
    useAnimatedStyle: (factory: () => Record<string, unknown>) => {
      const style = {};

      for (const key of Object.keys(factory())) {
        Object.defineProperty(style, key, { enumerable: true, get: () => factory()[key] });
      }

      return style;
    },
    useReducedMotion: () => mockUseReducedMotion(),
    useSharedValue: (initialValue: number) => React.useRef(createSharedValue(initialValue)).current,
    withRepeat: (value: number) => value,
    withTiming: (value: number, config?: unknown, callback?: unknown) =>
      callback === undefined
        ? mockWithTiming(value, config)
        : mockWithTiming(value, config, callback),
  };
});

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#ffffff',
      colorDark: '#111111',
      primaryAccent: '#ff6600',
      textLight: '#999999',
    },
  }),
}));

type ComposerProps = React.ComponentProps<typeof PlannerChatInput>;

const WRAPPING_TEXT = 'A sentence long enough to represent text wrapping onto a second visual line';
const INLINE_TEXT_LEFT_PADDING = 72;
const INLINE_TEXT_RIGHT_PADDING = 72;
const INLINE_TEXT_RIGHT_PADDING_WITH_SEND = 120;
// Tests run with reduced motion unless they opt out, which keeps the content in normal flow.
const INLINE_CONTENT_STYLE = {
  alignSelf: 'stretch',
  paddingLeft: INLINE_TEXT_LEFT_PADDING,
  paddingRight: INLINE_TEXT_RIGHT_PADDING,
  paddingVertical: 24,
};
const INLINE_CONTENT_STYLE_WITH_SEND = {
  ...INLINE_CONTENT_STYLE,
  paddingRight: INLINE_TEXT_RIGHT_PADDING_WITH_SEND,
};
const STACKED_CONTENT_STYLE = {
  alignSelf: 'stretch',
  paddingHorizontal: 16,
  paddingTop: PLANNER_CHAT_INPUT_VERTICAL_INSET,
  paddingBottom: PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT + PLANNER_CHAT_INPUT_VERTICAL_INSET,
};

// Jest has no native layout, so every measurement the composer reacts to is replayed by hand.
function layoutEvent(height: number) {
  return {
    nativeEvent: {
      layout: { x: 0, y: 0, width: 332, height },
    },
  };
}

function textLayoutEvent(lineCount: number, lineHeight = PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT) {
  return {
    nativeEvent: {
      lines: Array.from({ length: lineCount }, (_, index) => ({
        ascender: 0,
        capHeight: 0,
        descender: 0,
        height: lineHeight,
        text: '',
        width: 200,
        x: 0,
        xHeight: 0,
        y: index * lineHeight,
      })),
    },
  };
}

function renderComposer(props: Partial<ComposerProps> = {}) {
  const composerProps: ComposerProps = {
    isThinking: false,
    onChangeText: jest.fn(),
    onSubmit: jest.fn(),
    value: '',
    ...props,
  };
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<PlannerChatInput {...composerProps} />);
  });

  const update = (nextProps: Partial<ComposerProps>) => {
    Object.assign(composerProps, nextProps);
    act(() => {
      tree.update(<PlannerChatInput {...composerProps} />);
    });
  };

  return { tree: tree!, update };
}

function getInput(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-input' });
}

function getProbe(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-layout-probe' });
}

function getContent(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-content' });
}

function getFrame(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-frame' });
}

function getInputStyle(tree: ReturnType<typeof create>) {
  return StyleSheet.flatten(getInput(tree).props.style);
}

function getContentStyle(tree: ReturnType<typeof create>) {
  return StyleSheet.flatten(getContent(tree).props.style);
}

function getFrameStyle(tree: ReturnType<typeof create>) {
  return StyleSheet.flatten(getFrame(tree).props.style);
}

function getProbeWrapperStyle(tree: ReturnType<typeof create>) {
  return StyleSheet.flatten(getProbe(tree).parent!.props.style);
}

function reportProbeLines(tree: ReturnType<typeof create>, lineCount: number, lineHeight?: number) {
  act(() => {
    getProbe(tree).props.onTextLayout(textLayoutEvent(lineCount, lineHeight));
  });
}

function reportContentHeight(tree: ReturnType<typeof create>, height: number) {
  act(() => {
    getContent(tree).props.onLayout(layoutEvent(height));
  });
}

function reportInputHeight(tree: ReturnType<typeof create>, height: number) {
  act(() => {
    getInput(tree).props.onLayout(layoutEvent(height));
  });
}

function setPlatformOS(platform: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOS });
  mockUseReducedMotion.mockReset();
  mockUseReducedMotion.mockReturnValue(true);
  mockWithTiming.mockClear();
  mockFontScale = 1;
});

describe('PlannerChatInput native input', () => {
  it('renders a single TextInput that owns its height', () => {
    const { tree } = renderComposer({ value: 'Short text' });

    const inputs = tree.root.findAllByType(TextInput);
    const input = getInput(tree);
    const inputStyle = getInputStyle(tree);

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toBe(input);
    expect(input.props.value).toBe('Short text');
    expect(input.props.editable).toBe(true);
    expect(input.props.multiline).toBe(true);
    expect(input.props.submitBehavior).toBe('newline');
    expect(input.props.textAlignVertical).toBe('top');
    expect(input.props.textBreakStrategy).toBe('simple');
    // A single space makes the empty native input measure exactly one line.
    expect(input.props.placeholder).toBe(' ');
    expect(input.props.onContentSizeChange).toBeUndefined();
    expect('height' in inputStyle).toBe(false);
    expect(inputStyle).toEqual({
      color: '#ffffff',
      fontSize: 17,
      lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      minHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      maxHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2,
      padding: 0,
    });
  });

  it('keeps the native input free of a fixed height in every layout mode and at the line cap', () => {
    const { tree } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, PLANNER_CHAT_INPUT_MAX_LINES + 2);
    reportInputHeight(tree, PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES);
    reportContentHeight(tree, PLANNER_CHAT_INPUT_MAX_HEIGHT);

    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
    expect('height' in getInputStyle(tree)).toBe(false);
    expect(getInputStyle(tree).padding).toBe(0);
  });
});

describe('PlannerChatInput submission', () => {
  it('forwards typed text to its owner', () => {
    const onChangeText = jest.fn();
    const { tree } = renderComposer({ onChangeText, value: 'Plan' });

    act(() => {
      getInput(tree).props.onChangeText('Plan a');
    });

    expect(onChangeText).toHaveBeenCalledWith('Plan a');
  });

  it('submits only when there is text and the assistant is idle', () => {
    const onSubmit = jest.fn();
    const { tree, update } = renderComposer({ onSubmit, value: '' });
    const getSubmit = () => tree.root.findByProps({ testID: 'planner-composer-submit' });

    expect(getSubmit().props.disabled).toBe(true);

    update({ value: '   ' });
    expect(getSubmit().props.disabled).toBe(true);

    update({ value: 'Plan a meal', isThinking: true });
    expect(getSubmit().props.disabled).toBe(true);

    update({ isThinking: false });
    expect(getSubmit().props.disabled).toBe(false);

    act(() => {
      getSubmit().props.onPress();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('reveals the send control only while there is text to send', () => {
    const { tree, update } = renderComposer({ value: '' });
    const getSendContainer = () =>
      tree.root.findByProps({ testID: 'planner-composer-submit' }).parent!;
    const getSendContainerStyle = () => StyleSheet.flatten(getSendContainer().props.style);

    expect(getSendContainer().props.pointerEvents).toBe('none');
    expect(getSendContainerStyle()).toEqual(expect.objectContaining({ width: 0, opacity: 0 }));

    update({ value: '   ' });

    expect(getSendContainer().props.pointerEvents).toBe('none');
    expect(getSendContainerStyle()).toEqual(expect.objectContaining({ width: 0, opacity: 0 }));

    update({ value: 'Plan' });

    expect(getSendContainer().props.pointerEvents).toBe('auto');
    expect(getSendContainerStyle()).toEqual(expect.objectContaining({ width: 48, opacity: 1 }));

    // Sending clears the draft, which hides the control again.
    update({ value: '' });

    expect(getSendContainer().props.pointerEvents).toBe('none');
    expect(getSendContainerStyle()).toEqual(expect.objectContaining({ width: 0, opacity: 0 }));
  });
});

describe('PlannerChatInput keyboard lift', () => {
  it('wires deterministic bottom-anchored geometry without a measurement anchor', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <PlannerChatInput
          value=""
          isThinking={false}
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
        />
      );
    });

    expect(useKeyboardAnimation).toHaveBeenCalledWith({
      mode: 'geometry',
      restingBottomOffset: 34 + CUSTOM_TAB_BAR_CONTENT_HEIGHT + PLANNER_CHAT_INPUT_CLEARANCE,
      clearance: PLANNER_CHAT_INPUT_CLEARANCE,
      // The bottom safe-area inset, which Android leaves out of the keyboard height it reports.
      bottomInset: 34,
    });
    expect(
      StyleSheet.flatten(tree!.root.findByProps({ testID: 'planner-composer-wrapper' }).props.style)
    ).toEqual(
      expect.objectContaining({
        transform: [{ translateY: -120 }],
        paddingBottom: 106,
      })
    );
    const keyboardResult = jest.mocked(useKeyboardAnimation).mock.results.at(-1)?.value;

    expect(keyboardResult).not.toHaveProperty('targetRef');
    expect(keyboardResult).not.toHaveProperty('onTargetLayout');
    expect(tree!.root.findAllByProps({ testID: 'planner-composer-target' })).toHaveLength(0);
  });
});

describe('PlannerChatInput layout mode', () => {
  it('keeps one line of text inline between the controls', () => {
    const { tree, update } = renderComposer({ value: '' });

    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE);
    // One native line centred on the control row gives the resting pill height.
    expect(getContentStyle(tree).paddingVertical * 2 + getInputStyle(tree).minHeight).toBe(
      PLANNER_CHAT_INPUT_MIN_HEIGHT
    );

    update({ value: 'Short text' });

    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE_WITH_SEND);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
  });

  it('does not reserve room for the send control while the value is only whitespace', () => {
    const { tree } = renderComposer({ value: '   ' });

    expect(getContentStyle(tree).paddingRight).toBe(INLINE_TEXT_RIGHT_PADDING);
    expect(getProbeWrapperStyle(tree).right).toBe(INLINE_TEXT_RIGHT_PADDING + 2);
  });

  it('stacks the text above the controls when the probe reports a wrap and returns inline when it fits again', () => {
    const { tree, update } = renderComposer({ value: 'Short text' });

    reportProbeLines(tree, 1);
    expect(getContentStyle(tree).paddingLeft).toBe(INLINE_TEXT_LEFT_PADDING);

    update({ value: WRAPPING_TEXT });
    reportProbeLines(tree, 2);

    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);
    expect(getInputStyle(tree).maxHeight).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES
    );

    update({ value: 'Short text' });
    reportProbeLines(tree, 1);

    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE_WITH_SEND);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
  });

  it('stacks on an explicit newline before the probe reports anything', () => {
    const { tree, update } = renderComposer({ value: 'First line' });

    update({ value: 'First line\n' });

    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);

    // iOS measures a trailing newline as a single line.
    reportProbeLines(tree, 1);

    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);
  });

  it('returns inline when the value is cleared without waiting for the probe', () => {
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, 3);
    expect(getContentStyle(tree).paddingHorizontal).toBe(16);

    update({ value: '' });

    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
  });

  it('keeps the measured line count across value changes until the probe reports again', () => {
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, 3);
    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);

    // The native emitter drops an unchanged line list, so a JS-side reset is never corrected.
    update({ value: `${WRAPPING_TEXT} and more` });
    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);

    update({ value: 'Short text' });
    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);

    reportProbeLines(tree, 1);
    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE_WITH_SEND);
  });

  it('does not reset the measured line count when the value is cleared', () => {
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, 3);
    update({ value: '' });
    expect(getContentStyle(tree)).toEqual(INLINE_CONTENT_STYLE);

    update({ value: WRAPPING_TEXT });
    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);
  });

  it('keeps the bottom control row reserved in both layout modes', () => {
    const { tree, update } = renderComposer({ value: 'Short text' });
    const readControlInsets = () => ({
      controls: StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-composer-controls' }).props.style
      ),
      plus: StyleSheet.flatten(
        tree.root.findByProps({ accessibilityLabel: 'Add meal detail' }).parent!.props.style
      ),
    });

    const inlineInsets = readControlInsets();

    expect(inlineInsets.controls).toEqual(
      expect.objectContaining({ right: 8, bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET })
    );
    expect(inlineInsets.plus).toEqual(
      expect.objectContaining({ left: 8, bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET })
    );

    update({ value: WRAPPING_TEXT });
    reportProbeLines(tree, 2);

    expect(readControlInsets()).toEqual(inlineInsets);
    // Stacked text ends exactly where the control row starts.
    expect(getContentStyle(tree).paddingBottom).toBe(
      inlineInsets.controls.bottom + PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT
    );
  });
});

describe('PlannerChatInput layout probe', () => {
  it('measures the value in a hidden text outside the content flow', () => {
    const { tree, update } = renderComposer({ value: '' });

    const probe = getProbe(tree);
    const probeWrapper = probe.parent!;

    expect(probe.props.children).toBe(' ');
    expect(probe.props.textBreakStrategy).toBe('simple');
    expect(probe.props.android_hyphenationFrequency).toBe('none');
    // Any height, flex or display constraint would truncate or skip the native line measurement.
    expect(StyleSheet.flatten(probe.props.style)).toEqual({
      fontSize: 17,
      lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
    });
    expect(probeWrapper.props.pointerEvents).toBe('none');
    expect(probeWrapper.props.accessibilityElementsHidden).toBe(true);
    expect(probeWrapper.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(
      getContent(tree).findAllByProps({ testID: 'planner-composer-layout-probe' })
    ).toHaveLength(0);

    update({ value: 'Short text' });

    expect(getProbe(tree)).toBe(probe);
    expect(getProbe(tree).props.children).toBe('Short text');
  });

  it('keeps the probe geometry independent of the layout mode and of the line height', () => {
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });
    const probe = getProbe(tree);
    const inlineProbeWrapperStyle = getProbeWrapperStyle(tree);

    // 2dp narrower than the inline text box, so the probe never flips later than the input wraps.
    expect(inlineProbeWrapperStyle).toEqual({
      position: 'absolute',
      top: 0,
      left: INLINE_TEXT_LEFT_PADDING,
      right: INLINE_TEXT_RIGHT_PADDING_WITH_SEND + 2,
      opacity: 0,
    });

    reportProbeLines(tree, 4, 27.81);

    expect(getContentStyle(tree).paddingHorizontal).toBe(16);
    expect(getProbe(tree)).toBe(probe);
    expect(getProbeWrapperStyle(tree)).toEqual(inlineProbeWrapperStyle);
    expect(StyleSheet.flatten(getProbe(tree).props.style)).toEqual({
      fontSize: 17,
      lineHeight: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
    });

    update({ value: '' });

    expect(getProbe(tree)).toBe(probe);
    expect(getProbeWrapperStyle(tree)).toEqual({
      ...inlineProbeWrapperStyle,
      right: INLINE_TEXT_RIGHT_PADDING + 2,
    });
  });
});

describe('PlannerChatInput native line height', () => {
  it('falls back to the scaled design line height before the probe reports', () => {
    mockFontScale = 1.3;
    const { tree, update } = renderComposer({ value: 'Short text' });

    expect(getInputStyle(tree).lineHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).minHeight).toBeCloseTo(31.2, 5);
    expect(getInputStyle(tree).maxHeight).toBeCloseTo(62.4, 5);
    expect(getContentStyle(tree).paddingVertical).toBeCloseTo(20.4, 5);

    update({ value: 'First line\nSecond line' });

    // Seven whole 31.2dp lines fit in the 240dp design viewport.
    expect(getInputStyle(tree).maxHeight).toBeCloseTo(218.4, 5);
  });

  it('sizes the input from the line height measured by the probe', () => {
    mockFontScale = 1.3;
    const { tree, update } = renderComposer({ value: 'Short text' });

    reportProbeLines(tree, 1, 27.81);

    expect(getInputStyle(tree).lineHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).minHeight).toBe(27.81);
    expect(getInputStyle(tree).maxHeight).toBeCloseTo(55.62, 5);
    expect(getContentStyle(tree).paddingVertical).toBeCloseTo(22.095, 5);

    update({ value: WRAPPING_TEXT });
    reportProbeLines(tree, 2, 27.81);

    // Eight whole 27.81dp lines fit in the 240dp design viewport.
    expect(getInputStyle(tree).minHeight).toBe(27.81);
    expect(getInputStyle(tree).maxHeight).toBeCloseTo(222.48, 5);
    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);
  });

  it('keeps the last usable line height when the probe reports an unusable one', () => {
    const { tree } = renderComposer({ value: 'Short text' });

    reportProbeLines(tree, 1, 27.81);

    for (const unusableLineHeight of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      reportProbeLines(tree, 1, unusableLineHeight);

      expect(getInputStyle(tree).minHeight).toBe(27.81);
    }

    act(() => {
      getProbe(tree).props.onTextLayout({ nativeEvent: { lines: [] } });
    });

    expect(getInputStyle(tree).minHeight).toBe(27.81);
    expect(getContentStyle(tree).paddingLeft).toBe(INLINE_TEXT_LEFT_PADDING);
  });

  it('stops centring the inline text once a line is taller than the control row', () => {
    const { tree } = renderComposer({ value: 'Short text' });

    reportProbeLines(tree, 1, 60);

    expect(getContentStyle(tree).paddingVertical).toBe(PLANNER_CHAT_INPUT_VERTICAL_INSET);
    expect(getInputStyle(tree).minHeight).toBe(60);
    expect(getInputStyle(tree).maxHeight).toBe(120);
  });

  it('keeps at least two lines visible at the largest accessibility sizes', () => {
    const { tree } = renderComposer({ value: 'First line\nSecond line' });

    reportProbeLines(tree, 2, 130);

    expect(getInputStyle(tree).maxHeight).toBe(260);
  });
});

// iOS measures the commit that clears the value with the text the native input still holds and
// does not measure it again, so the empty input cannot be left room for a second line.
describe('PlannerChatInput empty input', () => {
  it('holds the empty input at exactly one native line', () => {
    const { tree } = renderComposer({ value: '' });

    expect(getInputStyle(tree).minHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);

    reportProbeLines(tree, 1, 27.81);

    expect(getInputStyle(tree).minHeight).toBe(27.81);
    expect(getInputStyle(tree).maxHeight).toBe(27.81);
  });

  it('restores the two-line inline cap on the first typed character', () => {
    const { tree, update } = renderComposer({ value: '' });

    update({ value: 'P' });

    expect(getInputStyle(tree).minHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
  });

  it('collapses to one line as soon as a value at the line cap is cleared', () => {
    const cappedHeight = PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES;
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, PLANNER_CHAT_INPUT_MAX_LINES + 2);
    reportInputHeight(tree, cappedHeight);

    expect(getContentStyle(tree)).toEqual(STACKED_CONTENT_STYLE);
    expect(getInputStyle(tree).maxHeight).toBe(cappedHeight);

    // Sending clears the value before the probe or the native input report again.
    update({ value: '' });

    expect(getInputStyle(tree).minHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
  });

  it('does not treat a whitespace-only value as empty', () => {
    const { tree } = renderComposer({ value: '   ' });

    expect(getInputStyle(tree).minHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInputStyle(tree).maxHeight).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
  });
});

describe('PlannerChatInput frame height', () => {
  it.each([
    { name: 'Android', platform: 'android', reduceMotion: false },
    { name: 'Android with reduced motion', platform: 'android', reduceMotion: true },
    { name: 'iOS with reduced motion', platform: 'ios', reduceMotion: true },
  ] as const)(
    'lets the frame take its height from its in-flow content on $name',
    ({ platform, reduceMotion }) => {
      setPlatformOS(platform);
      mockUseReducedMotion.mockReturnValue(reduceMotion);
      const { tree, update } = renderComposer({ value: 'Short text' });
      mockWithTiming.mockClear();

      expect('height' in getFrameStyle(tree)).toBe(false);
      expect(getContentStyle(tree).alignSelf).toBe('stretch');
      expect(getContentStyle(tree).position).toBeUndefined();

      update({ value: WRAPPING_TEXT });
      reportProbeLines(tree, 3);
      reportContentHeight(tree, 96);
      reportContentHeight(tree, 144);

      expect('height' in getFrameStyle(tree)).toBe(false);
      expect(Object.keys(getFrameStyle(tree))).not.toContain('height');
      expect(getContentStyle(tree).alignSelf).toBe('stretch');
      expect(getContentStyle(tree).position).toBeUndefined();
      expect(mockWithTiming.mock.calls.map(([value]) => value)).not.toContain(96);
      expect(mockWithTiming.mock.calls.map(([value]) => value)).not.toContain(144);
    }
  );

  it('pins the content and tweens the frame toward the measured height on iOS', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    const onHeightChange = jest.fn();
    const { tree, update } = renderComposer({ onHeightChange, value: 'Short text' });
    mockWithTiming.mockClear();

    expect(getFrameStyle(tree).height).toBe(PLANNER_CHAT_INPUT_MIN_HEIGHT);
    expect(getContentStyle(tree)).toEqual(
      expect.objectContaining({ position: 'absolute', top: 0, left: 0, right: 0 })
    );
    expect(getContentStyle(tree).alignSelf).toBeUndefined();
    expect(getContentStyle(tree).bottom).toBeUndefined();
    expect(getContentStyle(tree).height).toBeUndefined();

    // The first measurement is assigned directly, so a pill that mounts taller never tweens open.
    reportContentHeight(tree, 83.62);

    expect(mockWithTiming).not.toHaveBeenCalled();
    expect(getFrameStyle(tree).height).toBe(83.62);

    update({ value: WRAPPING_TEXT });
    reportProbeLines(tree, 3);
    expect(getContentStyle(tree)).toEqual({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: 16,
      paddingTop: PLANNER_CHAT_INPUT_VERTICAL_INSET,
      paddingBottom: PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT + PLANNER_CHAT_INPUT_VERTICAL_INSET,
    });
    reportContentHeight(tree, 155.43);

    expect(mockWithTiming).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenLastCalledWith(155.43, {
      duration: 180,
      easing: expect.any(Function),
    });
    expect(getFrameStyle(tree).height).toBe(155.43);

    update({ value: '' });
    reportContentHeight(tree, 83.62);

    expect(mockWithTiming).toHaveBeenLastCalledWith(83.62, {
      duration: 180,
      easing: expect.any(Function),
    });
    expect(getFrameStyle(tree).height).toBe(83.62);
    expect(onHeightChange.mock.calls).toEqual([[83.62], [155.43], [83.62]]);
  });

  it('keeps the height strategy chosen at mount for the lifetime of the instance', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    const { tree, update } = renderComposer({ value: 'Short text' });

    mockUseReducedMotion.mockReturnValue(true);
    update({ value: 'Short text that changed' });
    reportContentHeight(tree, 72);
    reportContentHeight(tree, 96);

    expect(getFrameStyle(tree).height).toBe(96);
    expect(getContentStyle(tree).position).toBe('absolute');
    expect(mockWithTiming).toHaveBeenLastCalledWith(96, {
      duration: 180,
      easing: expect.any(Function),
    });
  });

  it('rounds the frame and its inner surface less as the composer grows', () => {
    setPlatformOS('android');
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });
    const getInnerSurfaceStyle = () =>
      StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-composer-inner-surface' }).props.style
      );

    expect(getFrameStyle(tree).borderRadius).toBe(28);
    expect(getInnerSurfaceStyle().borderRadius).toBe(28);

    reportContentHeight(tree, (PLANNER_CHAT_INPUT_MIN_HEIGHT + PLANNER_CHAT_INPUT_MAX_HEIGHT) / 2);

    expect(getFrameStyle(tree).borderRadius).toBe(24);
    expect(getInnerSurfaceStyle().borderRadius).toBe(24);

    reportContentHeight(tree, PLANNER_CHAT_INPUT_MAX_HEIGHT);

    expect(getFrameStyle(tree).borderRadius).toBe(20);
    expect(getInnerSurfaceStyle().borderRadius).toBe(20);

    update({ isThinking: true });

    expect(getFrameStyle(tree).borderRadius).toBe(20);
    expect(getInnerSurfaceStyle().borderRadius).toBe(18);
  });
});

describe('PlannerChatInput height reporting', () => {
  it('reports each distinct content height once', () => {
    const onHeightChange = jest.fn();
    const { tree } = renderComposer({ onHeightChange, value: 'Short text' });

    expect(onHeightChange).not.toHaveBeenCalled();

    reportContentHeight(tree, 72);
    reportContentHeight(tree, 72);
    reportContentHeight(tree, 72.4);
    reportContentHeight(tree, 71.2);
    reportContentHeight(tree, 96);
    reportContentHeight(tree, 96);
    reportContentHeight(tree, 72);

    expect(onHeightChange.mock.calls).toEqual([[72], [96], [72]]);
  });

  it('reports a change of a whole point', () => {
    const onHeightChange = jest.fn();
    const { tree } = renderComposer({ onHeightChange, value: 'Short text' });

    reportContentHeight(tree, 72);
    reportContentHeight(tree, 73);

    expect(onHeightChange.mock.calls).toEqual([[72], [73]]);
  });

  it('does not retarget the iOS tween for a sub-point change', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    const onHeightChange = jest.fn();
    const { tree } = renderComposer({ onHeightChange, value: 'Short text' });

    reportContentHeight(tree, 72);
    reportContentHeight(tree, 96);
    mockWithTiming.mockClear();
    onHeightChange.mockClear();

    reportContentHeight(tree, 96.33);
    reportContentHeight(tree, 95.67);

    expect(mockWithTiming).not.toHaveBeenCalled();
    expect(onHeightChange).not.toHaveBeenCalled();
    expect(getFrameStyle(tree).height).toBe(96);
  });

  it('measures the composer without a height listener', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    const { tree } = renderComposer({ value: 'Short text' });

    expect(() => reportContentHeight(tree, 96)).not.toThrow();
    expect(getFrameStyle(tree).height).toBe(96);
  });
});

describe('PlannerChatInput internal scrolling', () => {
  it('turns scrolling on only once the stacked input reaches its line cap', () => {
    const cappedHeight = PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES;
    const { tree } = renderComposer({ value: WRAPPING_TEXT });

    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportProbeLines(tree, 2);
    reportInputHeight(tree, PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportInputHeight(tree, cappedHeight - PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportInputHeight(tree, cappedHeight - 0.6);
    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportInputHeight(tree, cappedHeight - 0.5);
    expect(getInput(tree).props.scrollEnabled).toBe(true);

    reportInputHeight(tree, cappedHeight);
    expect(getInput(tree).props.scrollEnabled).toBe(true);

    reportInputHeight(tree, cappedHeight - PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT);
    expect(getInput(tree).props.scrollEnabled).toBe(false);
  });

  it('derives the cap from the measured line height', () => {
    const { tree } = renderComposer({ value: WRAPPING_TEXT });

    // Eight 27.81dp lines: the cap is 222.48dp, not a multiple of the design line height.
    reportProbeLines(tree, 9, 27.81);
    reportInputHeight(tree, 194.67);
    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportInputHeight(tree, 221.9);
    expect(getInput(tree).props.scrollEnabled).toBe(false);

    reportInputHeight(tree, 222.48);
    expect(getInput(tree).props.scrollEnabled).toBe(true);
  });

  it('never scrolls the inline input, even with a stale tall measurement', () => {
    const cappedHeight = PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES;
    const { tree, update } = renderComposer({ value: WRAPPING_TEXT });

    reportProbeLines(tree, PLANNER_CHAT_INPUT_MAX_LINES + 1);
    reportInputHeight(tree, cappedHeight);
    expect(getInput(tree).props.scrollEnabled).toBe(true);

    // Sending clears the value before the native input reports its collapsed layout.
    update({ value: '' });

    expect(getInput(tree).props.scrollEnabled).toBe(false);

    update({ value: 'Short text' });
    reportProbeLines(tree, 1);

    expect(getInput(tree).props.scrollEnabled).toBe(false);
  });
});

describe('PlannerChatInput icon optical alignment', () => {
  it('applies the same inner translateY offset to all composer icons without changing pressable geometry', () => {
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });

    const addMealDetailButton = tree!.root.findByProps({ accessibilityLabel: 'Add meal detail' });
    const voiceInputButton = tree!.root.findByProps({ accessibilityLabel: 'Voice input' });
    const sendMessageButton = tree!.root.findByProps({ accessibilityLabel: 'Send message' });

    expect(sendMessageButton.props.testID).toBe('planner-composer-submit');

    const addMealDetailIconWrapper = addMealDetailButton
      .findAllByType(View)
      .find((node) => StyleSheet.flatten(node.props.style)?.transform !== undefined);
    const voiceInputIconWrapper = voiceInputButton
      .findAllByType(View)
      .find((node) => StyleSheet.flatten(node.props.style)?.transform !== undefined);
    const sendMessageIconWrapper = sendMessageButton
      .findAllByType(View)
      .find((node) => StyleSheet.flatten(node.props.style)?.transform !== undefined);

    expect(addMealDetailIconWrapper).toBeDefined();
    expect(voiceInputIconWrapper).toBeDefined();
    expect(sendMessageIconWrapper).toBeDefined();

    expect(StyleSheet.flatten(addMealDetailButton.props.style)).toEqual(
      expect.objectContaining({ height: 42, width: 42 })
    );
    expect(StyleSheet.flatten(voiceInputButton.props.style)).toEqual(
      expect.objectContaining({ height: 42, width: 42 })
    );
    expect(StyleSheet.flatten(sendMessageButton.props.style)).toEqual(
      expect.objectContaining({ height: 42, width: 42 })
    );
    expect(addMealDetailButton.props.hitSlop).toBe(8);
    expect(voiceInputButton.props.hitSlop).toBe(8);
    expect(sendMessageButton.props.hitSlop).toBe(8);

    expect(StyleSheet.flatten(addMealDetailIconWrapper!.props.style)).toEqual(
      expect.objectContaining({
        transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }],
      })
    );
    expect(StyleSheet.flatten(voiceInputIconWrapper!.props.style)).toEqual(
      expect.objectContaining({
        transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }],
      })
    );
    expect(StyleSheet.flatten(sendMessageIconWrapper!.props.style)).toEqual(
      expect.objectContaining({
        transform: [{ translateY: PLANNER_CHAT_INPUT_ICON_OPTICAL_OFFSET_Y }],
      })
    );
  });
});

describe('PlannerChatInput surface opacity', () => {
  const props = {
    onChangeText: jest.fn(),
    onSubmit: jest.fn(),
    value: 'Plan a meal',
  };

  function getSurfaceOpacity(tree: ReturnType<typeof create>) {
    return StyleSheet.flatten(
      tree.root.findByProps({ testID: 'planner-composer-surface' }).props.style
    ).opacity;
  }

  it('gives the composer inner surface a defined absolute fill style', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} isThinking={false} />);
    });

    const surface = tree!.root.findByProps({ testID: 'planner-composer-surface' });

    expect(surface.props.style).toBeDefined();
    expect(StyleSheet.flatten(surface.props.style)).toEqual(
      expect.objectContaining({ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 })
    );
  });

  it('keeps the idle surface opaque and reduces only the surface while thinking', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} isThinking={false} />);
    });

    expect(getSurfaceOpacity(tree!)).toBe(1);
    expect(
      StyleSheet.flatten(tree!.root.findByProps({ accessibilityLabel: 'Voice input' }).props.style)
        .opacity
    ).toBeUndefined();
    expect(StyleSheet.flatten(getInput(tree!).props.style).opacity).toBeUndefined();

    act(() => {
      tree!.update(<PlannerChatInput {...props} isThinking />);
    });

    expect(getSurfaceOpacity(tree!)).toBe(0.6);
    expect(
      StyleSheet.flatten(tree!.root.findByProps({ accessibilityLabel: 'Voice input' }).props.style)
        .opacity
    ).toBeUndefined();
    expect(StyleSheet.flatten(getInput(tree!).props.style).opacity).toBeUndefined();
  });

  it('keeps its backing gradient mounted while returning from thinking to an opaque idle surface', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} isThinking />);
    });

    const gradient = tree!.root.findByProps({ testID: 'planner-composer-thinking-gradient' });
    const thinkingInnerSurface = tree!.root.findByProps({
      testID: 'planner-composer-inner-surface',
    });

    expect(StyleSheet.flatten(gradient.props.style)).toEqual(
      expect.objectContaining({ opacity: 1 })
    );
    expect(StyleSheet.flatten(thinkingInnerSurface.props.style)).toEqual(
      expect.objectContaining({ top: 2, right: 2, bottom: 2, left: 2, borderRadius: 26 })
    );
    expect(getSurfaceOpacity(tree!)).toBe(0.6);

    act(() => {
      tree!.update(<PlannerChatInput {...props} isThinking={false} />);
    });

    const idleGradient = tree!.root.findByProps({ testID: 'planner-composer-thinking-gradient' });
    const idleInnerSurface = tree!.root.findByProps({ testID: 'planner-composer-inner-surface' });

    expect(idleGradient).toBe(gradient);
    expect(StyleSheet.flatten(idleGradient.props.style)).toEqual(
      expect.objectContaining({ opacity: 0 })
    );
    expect(StyleSheet.flatten(idleInnerSurface.props.style)).toEqual(
      expect.objectContaining({ top: 0, right: 0, bottom: 0, left: 0, borderRadius: 28 })
    );
    expect(getSurfaceOpacity(tree!)).toBe(1);
    expect(
      StyleSheet.flatten(tree!.root.findByProps({ testID: 'planner-composer-frame' }).props.style)
    ).not.toHaveProperty('backgroundColor');
  });

  it('keeps the composer geometry stable while the thinking effect is active', () => {
    // The animated iOS frame carries an explicit height, so the comparison covers real numbers.
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    const { tree, update } = renderComposer({ value: '' });

    reportProbeLines(tree, 1);
    reportContentHeight(tree, PLANNER_CHAT_INPUT_MIN_HEIGHT);

    const readGeometry = () => {
      const innerSurface = tree.root.findByProps({ testID: 'planner-composer-inner-surface' });
      const controls = StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-composer-controls' }).props.style
      );
      const frameHeight = getFrameStyle(tree).height;

      return {
        frameHeight,
        content: getContentStyle(tree),
        input: getInputStyle(tree),
        probeWrapper: getProbeWrapperStyle(tree),
        controlsTop: frameHeight - controls.bottom - PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT,
        innerSurfaceContainsContent: innerSurface.findAllByProps({
          testID: 'planner-composer-input',
        }).length,
      };
    };

    const idleGeometry = readGeometry();

    expect(idleGeometry.frameHeight).toBe(PLANNER_CHAT_INPUT_MIN_HEIGHT);
    expect(idleGeometry.controlsTop).toBe(PLANNER_CHAT_INPUT_VERTICAL_INSET);
    expect(idleGeometry.content.paddingVertical).toBe(24);

    update({ isThinking: true });

    expect(readGeometry()).toEqual({
      ...idleGeometry,
      innerSurfaceContainsContent: 0,
    });
  });

  it('keeps the focused input editable while thinking so submit does not dismiss the keyboard', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="" isThinking />);
    });

    expect(getInput(tree!).props.editable).toBe(true);
  });

  it('keeps the visual layers behind interactive composer content', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="" isThinking={false} />);
    });

    const frame = tree!.root.findByProps({ testID: 'planner-composer-frame' });
    const gradient = tree!.root.findByProps({ testID: 'planner-composer-thinking-gradient' });
    const innerSurface = tree!.root.findByProps({ testID: 'planner-composer-inner-surface' });
    const input = getInput(tree!);

    expect(innerSurface.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(innerSurface.props.style).zIndex).toBeUndefined();
    const testIds = frame
      .findAll((node) => typeof node.props.testID === 'string')
      .map((node) => node.props.testID);

    expect(testIds.indexOf(gradient.props.testID)).toBeLessThan(
      testIds.indexOf(innerSurface.props.testID)
    );
    expect(testIds.indexOf(innerSurface.props.testID)).toBeLessThan(
      testIds.indexOf(input.props.testID)
    );
    expect(innerSurface.findAllByProps({ testID: 'planner-composer-controls' })).toHaveLength(0);
  });
});

describe('PlannerChatInput placeholder', () => {
  const props = {
    isThinking: false,
    onChangeText: jest.fn(),
    onSubmit: jest.fn(),
  };

  it('uses a non-interactive, subdued custom placeholder without changing typed text styling', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="" />);
    });

    const placeholder = tree!.root.findByProps({ testID: 'planner-composer-placeholder' });
    const placeholderText = placeholder.findByType(Text);
    const input = getInput(tree!);

    expect(placeholder.props.pointerEvents).toBe('none');
    expect(placeholder.props.accessibilityElementsHidden).toBe(true);
    expect(placeholder.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(placeholderText.props.children).toBe('Decile a la IA lo que te gustaria');
    expect(StyleSheet.flatten(placeholderText.props.style)).toEqual(
      expect.objectContaining({
        color: 'rgba(153, 153, 153, 0.6)',
        fontSize: 15,
        lineHeight: 20,
      })
    );
    // The blank native placeholder only gives the empty input its one-line height.
    expect(input.props.placeholder).toBe(' ');
    expect(StyleSheet.flatten(input.props.style).fontSize).toBe(17);
    expect(StyleSheet.flatten(input.props.style).opacity).toBeUndefined();

    act(() => {
      tree!.update(<PlannerChatInput {...props} value="Plan a meal" />);
    });

    expect(tree!.root.findAllByProps({ testID: 'planner-composer-placeholder' })).toHaveLength(0);
  });

  it('centres the placeholder on the first native line of the text box', () => {
    const { tree } = renderComposer({ value: '' });
    const getPlaceholderStyle = () =>
      StyleSheet.flatten(
        tree.root.findByProps({ testID: 'planner-composer-placeholder' }).props.style
      );

    expect(getInput(tree).parent).toBe(
      tree.root.findByProps({ testID: 'planner-composer-placeholder' }).parent
    );
    expect(getPlaceholderStyle()).toEqual({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      justifyContent: 'center',
    });

    reportProbeLines(tree, 1, 27.81);

    expect(getPlaceholderStyle().height).toBe(27.81);
  });
});
