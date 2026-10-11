import React from 'react';
import { Modal, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { CookingSummary } from '../domain';
import { CookingResultSheet } from './CookingResultSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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

const SUMMARY: CookingSummary = {
  scheduledMealId: 'meal-1',
  recipeName: 'Arroz con aceite',
  consumed: [
    { ingredientId: 'i1', name: 'Arroz', unit: 'g', quantity: '200 g', lots: 2 },
    { ingredientId: 'i2', name: 'Aceite', unit: 'ml', quantity: '15 ml', lots: 1 },
  ],
  shortages: [{ ingredientId: 'i3', name: 'Sal', unit: 'g', missing: '5 g' }],
};

function render(props: Partial<React.ComponentProps<typeof CookingResultSheet>>) {
  const onClose = jest.fn();
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <CookingResultSheet
        summary={null}
        errorMessage={null}
        onClose={onClose}
        leftoverPrompt={null}
        onAddLeftoverIngredient={jest.fn()}
        onCreatePreparedLeftover={jest.fn()}
        onCloseLeftoverPrompt={jest.fn()}
        {...props}
      />
    );
  });
  const texts = () =>
    tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
  return { tree: tree!, onClose, texts };
}

describe('CookingResultSheet', () => {
  it('renders nothing without a summary or an error', () => {
    const { texts, tree } = render({});

    expect(texts()).toEqual([]);
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
  });

  it('lists what was consumed per ingredient and what the stock could not cover', () => {
    const { texts } = render({ summary: SUMMARY });

    expect(texts()).toEqual(
      expect.arrayContaining([
        'Arroz con aceite',
        'Arroz',
        '200 g',
        'Aceite',
        '15 ml',
        'Te faltó',
        'Sal',
        '5 g',
      ])
    );
  });

  it('gives one ingredient in two units a row of its own per unit', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { texts } = render({
      summary: {
        scheduledMealId: 'meal-1',
        recipeName: 'Arroz con aceite',
        consumed: [
          { ingredientId: 'i1', name: 'Arroz', unit: 'g', quantity: '100 g', lots: 1 },
          { ingredientId: 'i1', name: 'Arroz', unit: 'unit', quantity: '2 u', lots: 1 },
        ],
        shortages: [
          { ingredientId: 'i3', name: 'Sal', unit: 'g', missing: '5 g' },
          { ingredientId: 'i3', name: 'Sal', unit: 'unit', missing: '1 u' },
        ],
      },
    });

    expect(texts()).toEqual(expect.arrayContaining(['100 g', '2 u', '5 g', '1 u']));
    // React reports rows that share a key through console.error.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not show the shortfall block when everything was covered', () => {
    const { texts } = render({ summary: { ...SUMMARY, shortages: [] } });

    expect(texts()).not.toContain('Te faltó');
  });

  it('shows the error message instead of a summary', () => {
    const { texts } = render({
      errorMessage: 'Solo podés marcar como cocinada una comida de hoy.',
    });

    expect(texts()).toContain('Solo podés marcar como cocinada una comida de hoy.');
  });

  it('closes from the backdrop and the back button too', () => {
    const { tree, onClose } = render({ summary: SUMMARY });

    act(() => tree.root.findByProps({ accessibilityLabel: 'Cerrar' }).props.onPress());
    act(() => tree.root.findByType(Modal).props.onRequestClose());

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes from the button', () => {
    const { tree, onClose } = render({ summary: SUMMARY });

    act(() => {
      tree.root
        .findByProps({ testID: 'cooking-result-close', accessibilityRole: 'button' })
        .props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
