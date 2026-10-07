/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import { withTiming } from 'react-native-reanimated';
import { withOpacity } from '@/utils/colors';
import { SegmentedSwitcher } from '../SegmentedSwitcher';

jest.mock('react-native-reanimated', () => {
  const { useReducer, useRef } = require('react');
  const { Text, View } = require('react-native');

  // One shared value per hook call for the whole life of the component, as in the real
  // library. A write re-renders, so the styles read from the tree reflect it.
  function useSharedValue(initial: number) {
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const current = useRef(initial);
    const shared = useRef(null);

    if (!shared.current) {
      shared.current = {
        get value() {
          return current.current;
        },
        set value(next: number) {
          if (current.current === next) return;
          current.current = next;
          rerender();
        },
      };
    }

    return shared.current;
  }

  return {
    __esModule: true,
    default: { Text, View },
    Easing: { out: (curve: unknown) => ({ out: curve }), quad: 'quad' },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue,
    // Resolves to its target at once; the calls tell an animated write from a direct one.
    withTiming: jest.fn((value: number) => value),
  };
});

const mockTheme = {
  colorDark: '#111111',
  icon: '#cccccc',
  textLight: '#eeeeee',
  textMedium: '#bbbbbb',
};

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockTheme }),
}));

jest.mock('@/hooks/useAnimatedThemeStyle', () => ({
  useAnimatedThemeStyle: (colors: object) => colors,
}));

type Grouping = 'category' | 'supermarket';

const OPTIONS: { value: Grouping; label: string }[] = [
  { value: 'category', label: 'Por categoría' },
  { value: 'supermarket', label: 'Por súper' },
];

function renderSwitcher(value: Grouping) {
  const onChange = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(<SegmentedSwitcher options={OPTIONS} value={value} onChange={onChange} />);
  });

  return { tree: tree!, root: tree!.root, onChange };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getButtons(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

function getButton(root: ReactTestInstance, label: string): ReactTestInstance {
  const button = getButtons(root).find((candidate) => getTexts(candidate).includes(label));

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  return button;
}

function pressButton(root: ReactTestInstance, label: string) {
  act(() => {
    getButton(root, label).props.onPress();
  });
}

function getSelectedLabels(root: ReactTestInstance): string[] {
  return getButtons(root)
    .filter((button) => button.props.accessibilityState?.selected === true)
    .flatMap((button) => getTexts(button));
}

interface Frame {
  x: number;
  width: number;
  height: number;
}

// Two equal options inside a container with 5 px of padding.
const CATEGORY_FRAME: Frame = { x: 5, width: 100, height: 32 };
const SUPERMARKET_FRAME: Frame = { x: 105, width: 100, height: 32 };

const SLIDE_CONFIG = { duration: 300, easing: { out: 'quad' } };

function layoutOption(root: ReactTestInstance, label: string, frame: Frame) {
  act(() => {
    getButton(root, label).props.onLayout({ nativeEvent: { layout: { y: 5, ...frame } } });
  });
}

function layoutAllOptions(root: ReactTestInstance) {
  layoutOption(root, 'Por categoría', CATEGORY_FRAME);
  layoutOption(root, 'Por súper', SUPERMARKET_FRAME);
}

function getIndicatorStyle(root: ReactTestInstance) {
  const [indicator] = root.findAll((node) => node.props.testID === 'segmented-switcher-indicator');

  return StyleSheet.flatten(indicator.props.style);
}

/** Targets of the writes that went through the 300 ms slide. */
function getSlideTargets(): number[] {
  return jest
    .mocked(withTiming)
    .mock.calls.filter(([, config]) => config?.duration === SLIDE_CONFIG.duration)
    .map(([target]) => target as number);
}

describe('SegmentedSwitcher', () => {
  beforeEach(() => {
    jest.mocked(withTiming).mockClear();
  });

  it('renders the label of every option in order', () => {
    const { root } = renderSwitcher('category');

    expect(getTexts(root)).toEqual(['Por categoría', 'Por súper']);
  });

  it('keeps every label on one line, shrinking it to fit a narrow option', () => {
    const { root } = renderSwitcher('category');

    const labels = root.findAllByType(Text).map(({ props }) => ({
      numberOfLines: props.numberOfLines,
      adjustsFontSizeToFit: props.adjustsFontSizeToFit,
      minimumFontScale: props.minimumFontScale,
    }));

    expect(labels).toEqual([
      { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8 },
      { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8 },
    ]);
  });

  it('exposes every option as a button and marks only the current value as selected', () => {
    const { root } = renderSwitcher('supermarket');

    expect(getButtons(root).flatMap((button) => getTexts(button))).toEqual([
      'Por categoría',
      'Por súper',
    ]);
    expect(getButton(root, 'Por categoría').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false })
    );
    expect(getSelectedLabels(root)).toEqual(['Por súper']);
  });

  it('reports the value of the pressed option', () => {
    const { root, onChange } = renderSwitcher('category');

    pressButton(root, 'Por súper');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('supermarket');
  });

  it('ignores a press on the option that is already selected', () => {
    const { root, onChange } = renderSwitcher('category');

    pressButton(root, 'Por categoría');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the selection when the parent changes the value', () => {
    const { tree, root, onChange } = renderSwitcher('category');

    expect(getSelectedLabels(root)).toEqual(['Por categoría']);

    act(() => {
      tree.update(<SegmentedSwitcher options={OPTIONS} value="supermarket" onChange={onChange} />);
    });

    expect(getSelectedLabels(root)).toEqual(['Por súper']);

    // The option that used to be selected is pressable again.
    pressButton(root, 'Por categoría');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('category');
  });

  it('keeps the indicator hidden until the selected option is measured', () => {
    const { root } = renderSwitcher('category');

    expect(getIndicatorStyle(root)).toEqual(expect.objectContaining({ opacity: 0 }));
  });

  it('places the indicator on the selected option, centred at 92% of its width', () => {
    const { root } = renderSwitcher('category');

    layoutAllOptions(root);

    const style = getIndicatorStyle(root);

    // 92 wide inside a 100 wide option starting at x = 5 leaves 4 on each side.
    expect(style.transform).toEqual([{ translateX: 9 }]);
    expect(style.width).toBeCloseTo(92);
    expect(style.height).toBe(32);
    expect(style.opacity).toBe(1);
    expect(style).toEqual(expect.objectContaining({ left: 0, position: 'absolute', top: 5 }));
  });

  it('appears in place on first layout instead of sliding in', () => {
    const { root } = renderSwitcher('supermarket');

    layoutAllOptions(root);

    expect(getIndicatorStyle(root).transform).toEqual([{ translateX: 109 }]);
    expect(getSlideTargets()).toEqual([]);
  });

  it('slides the indicator to the geometry of the newly selected option', () => {
    const { tree, root, onChange } = renderSwitcher('category');

    layoutAllOptions(root);
    layoutOption(root, 'Por súper', { x: 105, width: 120, height: 36 });
    jest.mocked(withTiming).mockClear();

    act(() => {
      tree.update(<SegmentedSwitcher options={OPTIONS} value="supermarket" onChange={onChange} />);
    });

    const style = getIndicatorStyle(root);

    // 92% of 120 is 110.4, so the pill sits 4.8 inside the option that starts at 105.
    expect(style.transform).toEqual([{ translateX: expect.closeTo(109.8) }]);
    expect(style.width).toBeCloseTo(110.4);
    expect(style.height).toBe(36);
    expect(jest.mocked(withTiming)).toHaveBeenCalledWith(expect.closeTo(109.8), SLIDE_CONFIG);
    expect(jest.mocked(withTiming)).toHaveBeenCalledWith(expect.closeTo(110.4), SLIDE_CONFIG);
    expect(jest.mocked(withTiming)).toHaveBeenCalledWith(36, SLIDE_CONFIG);
  });

  it('follows a resized selected option without sliding', () => {
    const { root } = renderSwitcher('category');

    layoutAllOptions(root);
    jest.mocked(withTiming).mockClear();

    // The container grew: same selection, wider frame.
    layoutOption(root, 'Por categoría', { x: 5, width: 150, height: 40 });

    const style = getIndicatorStyle(root);

    expect(style.transform).toEqual([{ translateX: 11 }]);
    expect(style.width).toBeCloseTo(138);
    expect(style.height).toBe(40);
    expect(getSlideTargets()).toEqual([]);
  });

  it('tints the indicator with the palette icon token', () => {
    const { root } = renderSwitcher('category');

    expect(getIndicatorStyle(root)).toEqual(
      expect.objectContaining({
        backgroundColor: withOpacity(mockTheme.icon, 0.15),
        borderColor: withOpacity(mockTheme.icon, 0.3),
        borderWidth: 1,
      })
    );
  });

  it('handles more than two options and non-string values', () => {
    const onChange = jest.fn();
    let tree: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <SegmentedSwitcher
          options={[
            { value: 7, label: 'Semana' },
            { value: 14, label: 'Quincena' },
            { value: 30, label: 'Mes' },
          ]}
          value={14}
          onChange={onChange}
        />
      );
    });

    const root = tree!.root;

    expect(getTexts(root)).toEqual(['Semana', 'Quincena', 'Mes']);
    expect(getSelectedLabels(root)).toEqual(['Quincena']);

    pressButton(root, 'Mes');

    expect(onChange).toHaveBeenCalledWith(30);
  });
});
