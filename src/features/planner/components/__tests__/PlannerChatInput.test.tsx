/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
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
import { PlannerChatInput } from '../PlannerChatInput';

const mockWithTiming = jest.fn((value: number, config?: unknown, callback?: unknown) => value);
const mockUseReducedMotion = jest.fn(() => true);
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

jest.mock('lucide-react-native', () => ({
  ArrowUp: () => null,
  Mic: () => null,
  Plus: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');

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
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => mockUseReducedMotion(),
    useSharedValue: (value: number) => ({ value }),
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

function contentSizeEvent(height: number) {
  return {
    nativeEvent: {
      contentSize: { width: 200, height },
    },
  };
}

function getInput(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-input' });
}

function getControlSafeInput(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-control-safe-input' });
}

function getMultilineMeasurementInput(tree: ReturnType<typeof create>): ReactTestInstance {
  return tree.root.findByProps({ testID: 'planner-composer-multiline-measurement-input' });
}

function composerHeightForLines(lines: number) {
  return (
    PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
    PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
    PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * lines
  );
}

function setPlatformOS(platform: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
}

function growComposerToFourLines(tree: ReturnType<typeof create>) {
  act(() => {
    getControlSafeInput(tree).props.onContentSizeChange(
      contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
    );
  });
  act(() => {
    getMultilineMeasurementInput(tree).props.onContentSizeChange(
      contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 4)
    );
  });
}

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatformOS });
  mockUseReducedMotion.mockReset();
  mockUseReducedMotion.mockReturnValue(true);
  mockWithTiming.mockClear();
});

describe('PlannerChatInput composer height animation', () => {
  const props = {
    isThinking: false,
    onChangeText: jest.fn(),
    onSubmit: jest.fn(),
    value: 'Text that wraps after the first visual line',
  };

  it('assigns Android height changes immediately', () => {
    setPlatformOS('android');
    mockUseReducedMotion.mockReturnValue(false);
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} />);
    });
    mockWithTiming.mockClear();

    growComposerToFourLines(tree!);

    expect(mockWithTiming.mock.calls.map(([value]) => value)).not.toContain(
      composerHeightForLines(4)
    );
  });

  it('keeps the 180ms timing animation for iOS height changes', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(false);
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} />);
    });
    mockWithTiming.mockClear();

    growComposerToFourLines(tree!);

    expect(mockWithTiming).toHaveBeenLastCalledWith(composerHeightForLines(4), {
      duration: 180,
      easing: expect.any(Function),
    });
  });

  it('keeps reduced-motion height changes immediate on iOS', () => {
    setPlatformOS('ios');
    mockUseReducedMotion.mockReturnValue(true);
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} />);
    });
    mockWithTiming.mockClear();

    growComposerToFourLines(tree!);

    expect(mockWithTiming.mock.calls.map(([value]) => value)).not.toContain(
      composerHeightForLines(4)
    );
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

describe('PlannerChatInput wrapping', () => {
  it('projects 1→3→6→10→6 lines from independent full-width measurement', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });

    const initialVisibleInput = getInput(tree!);
    const initialMeasurementInput = getMultilineMeasurementInput(tree!);
    const controlSafeInput = getControlSafeInput(tree!);

    // Android can clamp the visible TextInput's content-size signal to its
    // assigned two-line viewport. Viewport sizing must not consume that signal.
    expect(initialVisibleInput.props.onContentSizeChange).toBeUndefined();
    expect(initialMeasurementInput.props.editable).toBe(false);
    expect(initialMeasurementInput.props.accessible).toBe(false);
    expect(initialMeasurementInput.props.scrollEnabled).toBe(false);
    expect(initialMeasurementInput.parent!.props.pointerEvents).toBe('none');
    expect(initialMeasurementInput.parent!.props.accessibilityElementsHidden).toBe(true);
    expect(initialMeasurementInput.parent!.props.importantForAccessibility).toBe(
      'no-hide-descendants'
    );
    expect(controlSafeInput.props.editable).toBe(false);
    expect(controlSafeInput.props.accessible).toBe(false);
    expect(controlSafeInput.parent!.props.pointerEvents).toBe('none');
    expect(controlSafeInput.parent!.props.accessibilityElementsHidden).toBe(true);
    expect(controlSafeInput.parent!.props.importantForAccessibility).toBe('no-hide-descendants');

    act(() => {
      initialMeasurementInput.props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });

    for (const lines of [3, 6, 10, 6]) {
      act(() => {
        tree!.update(
          <PlannerChatInput
            {...props}
            value={`Text whose full-width intrinsic measurement occupies ${lines} visual lines`}
          />
        );
      });
      act(() => {
        getControlSafeInput(tree!).props.onContentSizeChange(
          contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * Math.max(2, lines))
        );
        getMultilineMeasurementInput(tree!).props.onContentSizeChange(
          contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * lines)
        );
      });

      const visibleInput = getInput(tree!);
      const visibleInputStyle = StyleSheet.flatten(visibleInput.props.style);
      const textAreaStyle = StyleSheet.flatten(visibleInput.parent!.props.style);
      const measurementInput = getMultilineMeasurementInput(tree!);
      const measurementInputStyle = StyleSheet.flatten(measurementInput.props.style);
      const measurementAreaStyle = StyleSheet.flatten(measurementInput.parent!.props.style);
      const expectedHeight = composerHeightForLines(lines);
      const controlTop =
        expectedHeight - PLANNER_CHAT_INPUT_VERTICAL_INSET - PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT;

      expect(onHeightChange).toHaveBeenLastCalledWith(expectedHeight);
      expect(visibleInputStyle.height).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * lines);
      expect(visibleInput.props.scrollEnabled).toBe(lines === PLANNER_CHAT_INPUT_MAX_LINES);
      expect(textAreaStyle.top).toBe(PLANNER_CHAT_INPUT_VERTICAL_INSET);
      expect(textAreaStyle.bottom).toBe(
        PLANNER_CHAT_INPUT_VERTICAL_INSET + PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT
      );
      expect(textAreaStyle.top + visibleInputStyle.height).toBe(controlTop);
      expect(measurementAreaStyle.left).toBe(textAreaStyle.left);
      expect(measurementAreaStyle.right).toBe(textAreaStyle.right);
      expect(measurementInputStyle.lineHeight).toBe(visibleInputStyle.lineHeight);
      expect(measurementInputStyle.paddingHorizontal).toBe(visibleInputStyle.paddingHorizontal);
      expect(measurementInputStyle.paddingVertical).toBe(visibleInputStyle.paddingVertical);
      expect(measurementInputStyle.height).toBeUndefined();
      expect(measurementInputStyle.maxHeight).toBeUndefined();
    }
  });

  it('keeps one-line text within the control-safe insets when the send control is hidden', () => {
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

    const input = getInput(tree!);
    const textAreaStyle = StyleSheet.flatten(input.parent!.props.style);
    const inputStyle = StyleSheet.flatten(input.props.style);

    expect(textAreaStyle.left).toBe(56);
    expect(textAreaStyle.right).toBe(56);
    expect(inputStyle.paddingHorizontal).toBe(16);
  });

  it('grows at the first visual wrap and bounds text above the fixed control row', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });

    // The test renderer cannot perform native text wrapping. Guard the layout
    // precondition that lets the native TextInput report intrinsic growth, then
    // replay the one-line and two-line content-size measurements it emits.
    const initialInput = getInput(tree!);
    const initialTextAreaStyle = StyleSheet.flatten(initialInput.parent!.props.style);
    expect(initialInput.props.className ?? '').not.toContain('flex-1');
    expect(initialTextAreaStyle).toEqual(
      expect.objectContaining({
        top:
          PLANNER_CHAT_INPUT_VERTICAL_INSET +
          (PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT - PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT) / 2,
        left: 56,
        right: 104,
      })
    );
    expect(StyleSheet.flatten(initialInput.props.style).paddingHorizontal).toBe(16);
    expect(initialTextAreaStyle.height).toBeUndefined();
    expect(initialTextAreaStyle.bottom).toBeUndefined();

    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="A sentence long enough to represent text wrapping onto a second visual line"
        />
      );
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });

    const expectedHeight =
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
      PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2;
    expect(expectedHeight).toBeGreaterThan(PLANNER_CHAT_INPUT_MIN_HEIGHT);
    expect(onHeightChange).toHaveBeenLastCalledWith(expectedHeight);

    const input = getInput(tree!);
    const inputStyle = StyleSheet.flatten(input.props.style);
    const textAreaStyle = StyleSheet.flatten(input.parent!.props.style);
    expect(inputStyle.flex).toBeUndefined();
    expect(inputStyle.paddingHorizontal).toBe(0);
    expect(textAreaStyle.top).toBe(PLANNER_CHAT_INPUT_VERTICAL_INSET);
    expect(textAreaStyle.bottom).toBe(
      PLANNER_CHAT_INPUT_VERTICAL_INSET + PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT
    );
    expect(textAreaStyle.left).toBe(16);
    expect(textAreaStyle.right).toBe(16);
    expect(expectedHeight - textAreaStyle.bottom - textAreaStyle.top).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2
    );
    expect(textAreaStyle.height).toBeUndefined();
  });

  it('uses independent full-width measurement to size a ten-line multiline transition', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="A message that occupies ten lines in the hidden control-safe input and six lines in the wide visible input"
        />
      );
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
    });

    // The narrow measurement initiates multiline, but does not set its viewport height.
    expect(StyleSheet.flatten(getInput(tree!).parent!.props.style).left).toBe(16);

    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 6)
      );
    });

    const sixLineHeight =
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
      PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 6;
    const sixLineInput = getInput(tree!);

    expect(onHeightChange).toHaveBeenLastCalledWith(sixLineHeight);
    expect(StyleSheet.flatten(sixLineInput.props.style).height).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 6
    );
    expect(StyleSheet.flatten(sixLineInput.parent!.props.style).bottom).toBe(
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT + PLANNER_CHAT_INPUT_VERTICAL_INSET
    );

    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="A message that occupies ten actual lines in the wide visible input"
        />
      );
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(PLANNER_CHAT_INPUT_MAX_HEIGHT);
    expect(StyleSheet.flatten(getInput(tree!).props.style).height).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES
    );

    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="The same control-safe measurement can remain at ten lines while the visible input shrinks back to six"
        />
      );
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 6)
      );
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(sixLineHeight);
    expect(StyleSheet.flatten(getInput(tree!).props.style).height).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 6
    );
    expect(getInput(tree!).props.scrollEnabled).toBe(false);
  });

  it('uses the independent measurement through three and ten visual lines', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="Visual wrapping that needs three lines in the stable control-safe measurement input"
        />
      );
    });

    // The narrow input initiates multiline, while the unconstrained full-width
    // input supplies the viewport line count after its wider layout is available.
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 3)
      );
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });

    const expectedHeight =
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
      PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2;
    expect(onHeightChange).toHaveBeenLastCalledWith(expectedHeight);
    const threeLineInputStyle = StyleSheet.flatten(getInput(tree!).props.style);
    const threeLineTextAreaStyle = StyleSheet.flatten(getInput(tree!).parent!.props.style);
    const threeLineControlTop =
      expectedHeight - PLANNER_CHAT_INPUT_VERTICAL_INSET - PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT;

    expect(threeLineInputStyle.height).toBe(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2);
    expect(threeLineInputStyle.maxHeight).toBeUndefined();
    expect(threeLineTextAreaStyle.top + threeLineInputStyle.height).toBe(threeLineControlTop);

    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="Visual wrapping that needs every available line in the stable control-safe measurement input"
        />
      );
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES)
      );
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(PLANNER_CHAT_INPUT_MAX_HEIGHT);
    const maxLineInput = getInput(tree!);
    const maxLineInputStyle = StyleSheet.flatten(maxLineInput.props.style);
    const maxLineTextAreaStyle = StyleSheet.flatten(maxLineInput.parent!.props.style);
    const maxLineControlTop =
      PLANNER_CHAT_INPUT_MAX_HEIGHT -
      PLANNER_CHAT_INPUT_VERTICAL_INSET -
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT;

    expect(maxLineInput.props.scrollEnabled).toBe(true);
    expect(maxLineInputStyle.height).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES
    );
    expect(maxLineInputStyle.maxHeight).toBeUndefined();
    expect(maxLineTextAreaStyle.top + maxLineInputStyle.height).toBe(maxLineControlTop);
  });

  it('enters and exits multiline once when narrow and wide measurements disagree', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });

    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="Boundary text that wraps at the control-safe width but fits at the wide width"
        />
      );
    });

    // The stable control-safe measurement remains wrapped while the full-width
    // measurement reports one line. Repeating the pair must not change mode.
    for (let index = 0; index < 2; index += 1) {
      act(() => {
        getControlSafeInput(tree!).props.onContentSizeChange(
          contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
        );
      });
      act(() => {
        getMultilineMeasurementInput(tree!).props.onContentSizeChange(
          contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
        );
      });
    }

    expect(onHeightChange.mock.calls.map(([height]) => height)).toEqual([
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
        PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
        PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
    ]);
    expect(StyleSheet.flatten(getInput(tree!).parent!.props.style).left).toBe(16);

    act(() => {
      tree!.update(<PlannerChatInput {...props} value="Short text" />);
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });

    expect(onHeightChange.mock.calls.map(([height]) => height)).toEqual([
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
        PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
        PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      PLANNER_CHAT_INPUT_MIN_HEIGHT,
    ]);
    expect(StyleSheet.flatten(getInput(tree!).parent!.props.style).left).toBe(56);
  });

  it('ignores fractional one-line drift while preserving stable wrapped-line growth', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="" />);
    });

    const fractionalOneLineBaseline = 23.14285659790039;

    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(fractionalOneLineBaseline)
      );
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(fractionalOneLineBaseline)
      );
    });
    act(() => {
      tree!.update(<PlannerChatInput {...props} value="A" />);
    });

    // A physical Android device reports 24px for the first character after an
    // empty 23.14285659790039px baseline. This sub-line drift is still one line.
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(contentSizeEvent(24));
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(contentSizeEvent(24));
    });

    expect(onHeightChange).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(getInput(tree!).parent!.props.style).left).toBe(56);

    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="A sentence long enough to wrap at the control-safe width on Android"
        />
      );
    });

    const nearbyTwoLineMeasurements = [
      fractionalOneLineBaseline + PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      48,
      47.75,
    ];

    // A genuine line-height increase still enters multiline. Nearby fractional
    // native measurements must remain classified as two lines without oscillation.
    for (const measurement of nearbyTwoLineMeasurements) {
      act(() => {
        getControlSafeInput(tree!).props.onContentSizeChange(contentSizeEvent(measurement));
      });
      act(() => {
        getMultilineMeasurementInput(tree!).props.onContentSizeChange(
          contentSizeEvent(measurement)
        );
      });
    }

    const expectedHeight =
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
      PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2;
    expect(onHeightChange.mock.calls.map(([height]) => height)).toEqual([
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
        PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
        PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT,
      expectedHeight,
    ]);
    expect(StyleSheet.flatten(getInput(tree!).parent!.props.style).left).toBe(16);
  });

  it('caps the text viewport at ten visual lines and enables internal scrolling', () => {
    const onHeightChange = jest.fn();
    const props = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} value="Short text" />);
    });

    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...props}
          value="Text representing content that has wrapped beyond the visible composer limit"
        />
      );
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * (PLANNER_CHAT_INPUT_MAX_LINES + 1))
      );
    });

    expect(onHeightChange).toHaveBeenLastCalledWith(PLANNER_CHAT_INPUT_MAX_HEIGHT);

    const input = getInput(tree!);
    const inputStyle = StyleSheet.flatten(input.props.style);
    const textAreaStyle = StyleSheet.flatten(input.parent!.props.style);
    expect(input.props.scrollEnabled).toBe(true);
    expect(inputStyle.height).toBe(
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * PLANNER_CHAT_INPUT_MAX_LINES
    );
    expect(inputStyle.maxHeight).toBeUndefined();
    expect(textAreaStyle.height).toBeUndefined();
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

  it('keeps the idle surface opaque and reduces only the surface while thinking', () => {
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...props} isThinking={false} />);
    });

    expect(getSurfaceOpacity(tree!)).toBe(1);
    expect(
      tree!.root.findByProps({ accessibilityLabel: 'Voice input' }).props.style
    ).toBeUndefined();
    expect(StyleSheet.flatten(getInput(tree!).props.style).opacity).toBeUndefined();

    act(() => {
      tree!.update(<PlannerChatInput {...props} isThinking />);
    });

    expect(getSurfaceOpacity(tree!)).toBe(0.6);
    expect(
      tree!.root.findByProps({ accessibilityLabel: 'Voice input' }).props.style
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

  it('keeps controls in the bottom row while text switches from centered to multiline geometry', () => {
    const onHeightChange = jest.fn();
    const inputProps = {
      isThinking: false,
      onChangeText: jest.fn(),
      onHeightChange,
      onSubmit: jest.fn(),
    };
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(<PlannerChatInput {...inputProps} value="Short text" />);
    });

    const controls = tree!.root.findAllByProps({ className: 'absolute flex-row items-center' })[0];
    const plus = tree!.root.findByProps({ accessibilityLabel: 'Add meal detail' });
    const oneLineTextArea = StyleSheet.flatten(getInput(tree!).parent!.props.style);

    expect(StyleSheet.flatten(controls.props.style)).toEqual(
      expect.objectContaining({
        right: 8,
        bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET,
      })
    );
    expect(StyleSheet.flatten(plus.parent!.props.style)).toEqual(
      expect.objectContaining({
        left: 8,
        bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET,
      })
    );
    expect(oneLineTextArea.top).toBe(
      PLANNER_CHAT_INPUT_VERTICAL_INSET +
        (PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT - PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT) / 2
    );
    expect(oneLineTextArea.bottom).toBeUndefined();

    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT)
      );
    });
    act(() => {
      tree!.update(
        <PlannerChatInput
          {...inputProps}
          value="A sentence long enough to represent text wrapping onto a second visual line"
        />
      );
    });
    act(() => {
      getControlSafeInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });
    act(() => {
      getMultilineMeasurementInput(tree!).props.onContentSizeChange(
        contentSizeEvent(PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2)
      );
    });

    const multilineControls = tree!.root.findAllByProps({
      className: 'absolute flex-row items-center',
    })[0];
    const multilinePlus = tree!.root.findByProps({ accessibilityLabel: 'Add meal detail' });
    const multilineTextArea = StyleSheet.flatten(getInput(tree!).parent!.props.style);
    const multilineHeight =
      PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT +
      PLANNER_CHAT_INPUT_VERTICAL_INSET * 2 +
      PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2;
    const controlTop =
      multilineHeight - PLANNER_CHAT_INPUT_VERTICAL_INSET - PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT;

    expect(StyleSheet.flatten(multilineControls.props.style)).toEqual(
      expect.objectContaining({ bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET })
    );
    expect(StyleSheet.flatten(multilinePlus.parent!.props.style)).toEqual(
      expect.objectContaining({ bottom: PLANNER_CHAT_INPUT_VERTICAL_INSET })
    );
    expect(multilineTextArea.top).toBe(PLANNER_CHAT_INPUT_VERTICAL_INSET);
    expect(multilineTextArea.bottom).toBe(
      PLANNER_CHAT_INPUT_VERTICAL_INSET + PLANNER_CHAT_INPUT_CONTROL_ROW_HEIGHT
    );
    expect(multilineHeight - multilineTextArea.bottom).toBe(controlTop);
    expect(multilineTextArea.top + PLANNER_CHAT_INPUT_TEXT_LINE_HEIGHT * 2).toBe(controlTop);
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
    expect(StyleSheet.flatten(placeholderText.props.style)).toEqual(
      expect.objectContaining({
        color: 'rgba(153, 153, 153, 0.6)',
        fontSize: 15,
        lineHeight: 20,
      })
    );
    expect(input.props.placeholder).toBeUndefined();
    expect(input.props.className).toContain('text-[17px]');
    expect(StyleSheet.flatten(input.props.style).opacity).toBeUndefined();

    act(() => {
      tree!.update(<PlannerChatInput {...props} value="Plan a meal" />);
    });

    expect(tree!.root.findAllByProps({ testID: 'planner-composer-placeholder' })).toHaveLength(0);
  });
});
