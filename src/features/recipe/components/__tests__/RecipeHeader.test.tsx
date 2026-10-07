import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RecipeHeader } from '../RecipeHeader';

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorBlack: '#111111',
      primaryAccent: '#ff6600',
    },
  }),
}));

type HeaderProps = React.ComponentProps<typeof RecipeHeader>;

function render(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    top: 47,
    title: 'Pollo con arroz y tomate',
    isFavorite: false,
    canMarkAsCooked: true,
    onBack: jest.fn(),
    onToggleFavorite: jest.fn(),
    onMarkAsCooked: jest.fn(),
    ...overrides,
  };
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(<RecipeHeader {...props} />);
  });

  return { tree: tree!, props };
}

// The role narrows the match to the pressable itself, past the wrapper that forwards the testID.
function findButton(tree: ReactTestRenderer, testID: string) {
  return tree.root.findByProps({ testID, accessibilityRole: 'button' });
}

function press(tree: ReactTestRenderer, testID: string) {
  // Calls the handler the button was given; the disabled state is asserted on its own.
  const button = findButton(tree, testID);

  act(() => {
    button.props.onPress?.();
  });

  return button;
}

describe('RecipeHeader', () => {
  it('shows the recipe name on a single line', () => {
    const { tree } = render();
    const title = tree.root.findByType(Text);

    expect(title.props.children).toBe('Pollo con arroz y tomate');
    expect(title.props.numberOfLines).toBe(1);
  });

  it('goes back when the back button is pressed', () => {
    const { tree, props } = render();
    const back = press(tree, 'recipe-header-back');

    expect(back.props.accessibilityLabel).toBe('Volver');
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('toggles the favorite and names the action it will perform', () => {
    const { tree, props } = render();
    const favorite = press(tree, 'recipe-header-favorite');

    expect(favorite.props.accessibilityLabel).toBe('Agregar a favoritos');
    expect(favorite.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it('offers to remove a recipe that is already a favorite', () => {
    const { tree } = render({ isFavorite: true });
    const favorite = findButton(tree, 'recipe-header-favorite');

    expect(favorite.props.accessibilityLabel).toBe('Quitar de favoritos');
    expect(favorite.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('marks the meal as cooked when it is allowed', () => {
    const { tree, props } = render();
    const cooked = press(tree, 'recipe-header-cooked');

    expect(cooked.props.accessibilityLabel).toBe('Marcar como cocinada');
    expect(cooked.props.disabled).toBe(false);
    expect(props.onMarkAsCooked).toHaveBeenCalledTimes(1);
  });

  it('disables the cooked button when the meal cannot be marked', () => {
    const { tree } = render({ canMarkAsCooked: false });
    const cooked = findButton(tree, 'recipe-header-cooked');

    expect(cooked.props.disabled).toBe(true);
    expect(cooked.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
});
