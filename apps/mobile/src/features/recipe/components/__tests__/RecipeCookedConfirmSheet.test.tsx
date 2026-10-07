import React from 'react';
import { Modal, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RecipeCookedConfirmSheet } from '../RecipeCookedConfirmSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000001',
      textLight: '#eeeeee',
    },
  }),
}));

function renderSheet(visible = true) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(
      <RecipeCookedConfirmSheet visible={visible} onConfirm={onConfirm} onCancel={onCancel} />
    );
  });

  return { tree: tree!, onConfirm, onCancel };
}

function renderedTexts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node) => String(node.props.children));
}

// The role narrows the match to the pressable itself, past the wrapper that forwards the testID.
function press(tree: ReactTestRenderer, testID: string) {
  act(() => {
    tree.root.findByProps({ testID, accessibilityRole: 'button' }).props.onPress();
  });
}

describe('RecipeCookedConfirmSheet', () => {
  it('asks whether the recipe was cooked and offers only yes and no', () => {
    const { tree } = renderSheet();

    expect(renderedTexts(tree)).toEqual(['¿Cocinaste la receta?', 'Sí', 'No']);
    expect(tree.root.findByProps({ accessibilityRole: 'header' }).props.children).toBe(
      '¿Cocinaste la receta?'
    );
  });

  it('renders nothing while it is not visible', () => {
    const { tree } = renderSheet(false);

    expect(renderedTexts(tree)).toEqual([]);
    expect(tree.root.findAllByProps({ testID: 'recipe-cooked-confirm-sheet' })).toHaveLength(0);
  });

  it('confirms from "Sí" without cancelling', () => {
    const { tree, onConfirm, onCancel } = renderSheet();

    press(tree, 'recipe-cooked-confirm-yes');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels from "No" without confirming', () => {
    const { tree, onConfirm, onCancel } = renderSheet();

    press(tree, 'recipe-cooked-confirm-no');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels from a press on the backdrop', () => {
    const { tree, onConfirm, onCancel } = renderSheet();

    act(() => {
      tree.root
        .findByProps({ accessibilityLabel: 'Cerrar', accessibilityRole: 'button' })
        .props.onPress();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels from the Android back button', () => {
    const { tree, onConfirm, onCancel } = renderSheet();

    act(() => {
      tree.root.findByType(Modal).props.onRequestClose();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('is announced as a modal panel drawn with the active palette', () => {
    const { tree } = renderSheet();
    const panel = tree.root.findByProps({
      testID: 'recipe-cooked-confirm-sheet',
      accessibilityViewIsModal: true,
    });

    expect(StyleSheet.flatten(panel.props.style)).toMatchObject({
      backgroundColor: '#111111',
      // The bottom inset plus the resting gap, so the actions clear the home indicator.
      paddingBottom: 34 + 16,
    });
  });
});
