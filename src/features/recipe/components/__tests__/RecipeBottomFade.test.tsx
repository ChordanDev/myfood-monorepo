import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { withOpacity } from '@/utils/colors';
import { RecipeBottomFade } from '../RecipeBottomFade';

const WINDOW_HEIGHT = 844;
const GROUND = '#ffffff';

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: 'LinearGradient',
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      appBg: '#ffffff',
    },
  }),
}));

function render(height: number) {
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(<RecipeBottomFade height={height} />);
  });

  return tree!;
}

function styleOf(tree: ReactTestRenderer, testID: string) {
  const [node] = tree.root.findAll(
    (candidate) => typeof candidate.type === 'string' && candidate.props.testID === testID
  );

  return StyleSheet.flatten(node.props.style);
}

describe('RecipeBottomFade', () => {
  it('melts into the ground over the height it is given, from the bottom edge of its container', () => {
    const tree = render(156);
    const gradient = tree.root.findByType('LinearGradient' as never);

    expect(styleOf(tree, 'recipe-bottom-fade')).toEqual(
      expect.objectContaining({ position: 'absolute', bottom: 0, left: 0, right: 0, height: 156 })
    );
    expect(gradient.props.colors).toEqual([withOpacity(GROUND, 0), GROUND]);
  });

  it('hangs solid ground below itself, so nothing shows under it once the keyboard lifts it', () => {
    const tree = render(156);
    const ground = styleOf(tree, 'recipe-bottom-fade-ground');

    // It starts at the bottom edge of the fade, off screen at rest, and is as tall as the window:
    // no keyboard can lift the fade further than that.
    expect(ground).toEqual(
      expect.objectContaining({
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        height: WINDOW_HEIGHT,
        backgroundColor: GROUND,
      })
    );
  });

  it('never takes a touch away from what it covers', () => {
    const [fade] = render(156).root.findAll(
      (candidate) =>
        typeof candidate.type === 'string' && candidate.props.testID === 'recipe-bottom-fade'
    );

    expect(fade.props.pointerEvents).toBe('none');
  });
});
