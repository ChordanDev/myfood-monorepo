import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { RecipeThemeConfig } from '@/types/domain';
import { useActivateRecipePalette } from '../useActivateRecipePalette';

const mockSetRecipeTheme = jest.fn();
let mockActiveTheme: RecipeThemeConfig;

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({ theme: mockActiveTheme, setRecipeTheme: mockSetRecipeTheme }),
}));

function buildPalette(appBg: string): RecipeThemeConfig {
  return {
    colorBlack: '#000001',
    colorDark: '#000002',
    colorMedium: '#000003',
    colorLight: '#000004',
    primaryAccent: '#000005',
    appBg,
    icon: '#000006',
    textBlack: '#000007',
    textDark: '#000008',
    textMedium: '#000009',
    textLight: '#00000a',
    primaryAccentIntense: '#00000b',
    alert: '#00000c',
  };
}

const HOME_PALETTE = buildPalette('#aaaaaa');
const RECIPE_PALETTE = buildPalette('#bbbbbb');
const OTHER_RECIPE_PALETTE = buildPalette('#cccccc');

type Palette = RecipeThemeConfig | null | undefined;

function Harness({ palette }: { palette: Palette }) {
  useActivateRecipePalette(palette);
  return null;
}

function mount(palette: Palette) {
  let tree: ReactTestRenderer;

  act(() => {
    tree = create(<Harness palette={palette} />);
  });

  return tree!;
}

describe('useActivateRecipePalette', () => {
  beforeEach(() => {
    mockSetRecipeTheme.mockClear();
    mockActiveTheme = HOME_PALETTE;
  });

  it('activates the palette of the recipe on mount', () => {
    mount(RECIPE_PALETTE);

    expect(mockSetRecipeTheme).toHaveBeenCalledTimes(1);
    expect(mockSetRecipeTheme).toHaveBeenCalledWith(RECIPE_PALETTE);
  });

  it('leaves the active palette alone while there is no recipe', () => {
    mount(undefined);

    expect(mockSetRecipeTheme).not.toHaveBeenCalled();
  });

  it('draws a recipe without a palette in the default one, and restores the previous on leaving', () => {
    const tree = mount(null);

    expect(mockSetRecipeTheme.mock.calls).toEqual([[null]]);

    act(() => {
      tree.unmount();
    });

    expect(mockSetRecipeTheme).toHaveBeenLastCalledWith(HOME_PALETTE);
  });

  it('does not activate the same palette again on a re-render', () => {
    const tree = mount(RECIPE_PALETTE);
    // The provider re-renders its consumers with the palette that was just activated.
    mockActiveTheme = RECIPE_PALETTE;

    act(() => {
      tree.update(<Harness palette={RECIPE_PALETTE} />);
    });

    expect(mockSetRecipeTheme).toHaveBeenCalledTimes(1);
  });

  it('activates the new palette when the recipe palette changes', () => {
    const tree = mount(RECIPE_PALETTE);

    act(() => {
      tree.update(<Harness palette={OTHER_RECIPE_PALETTE} />);
    });

    expect(mockSetRecipeTheme).toHaveBeenLastCalledWith(OTHER_RECIPE_PALETTE);
  });

  it('hands the previous palette back when there is no recipe any more', () => {
    const tree = mount(RECIPE_PALETTE);
    mockSetRecipeTheme.mockClear();

    act(() => {
      tree.update(<Harness palette={undefined} />);
    });

    expect(mockSetRecipeTheme).toHaveBeenLastCalledWith(HOME_PALETTE);
  });

  it('restores before it activates again, so the recipe palette is the one left active', () => {
    const tree = mount(RECIPE_PALETTE);
    mockSetRecipeTheme.mockClear();

    act(() => {
      tree.update(<Harness palette={OTHER_RECIPE_PALETTE} />);
    });

    expect(mockSetRecipeTheme.mock.calls).toEqual([[HOME_PALETTE], [OTHER_RECIPE_PALETTE]]);
  });

  it('restores the palette that was active before the screen mounted when it leaves', () => {
    const tree = mount(RECIPE_PALETTE);
    mockActiveTheme = RECIPE_PALETTE;

    act(() => {
      tree.update(<Harness palette={RECIPE_PALETTE} />);
    });
    mockSetRecipeTheme.mockClear();

    act(() => {
      tree.unmount();
    });

    expect(mockSetRecipeTheme).toHaveBeenCalledTimes(1);
    expect(mockSetRecipeTheme).toHaveBeenCalledWith(HOME_PALETTE);
  });
});
