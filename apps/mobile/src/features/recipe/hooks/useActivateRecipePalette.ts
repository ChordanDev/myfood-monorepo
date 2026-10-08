import { useLayoutEffect, useRef } from 'react';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { RecipeThemeConfig } from '@/types/domain';

/**
 * Draws the screen in the recipe's own palette while it is mounted, and hands the app back the
 * palette it had before. Home only applies a meal palette for today, so without this a recipe
 * opened from another day would be drawn in the fallback palette.
 *
 * `null` is a recipe that has no palette: it is drawn in the default one, not in the palette of
 * whatever meal was active. `undefined` is no recipe yet, which leaves the active palette alone.
 */
export function useActivateRecipePalette(palette: RecipeThemeConfig | null | undefined): void {
  const { theme, setRecipeTheme } = useRecipeTheme();
  // Captured on the first render only: later renders already see the recipe palette.
  const paletteBeforeMountRef = useRef(theme);

  // A layout effect, so the first painted frame already uses the recipe palette. Activating and
  // restoring are one effect: whenever it runs again, the restore comes first and the recipe
  // palette is the one left active. It depends only on the recipe palette, never on the active
  // one, so activating it cannot loop.
  useLayoutEffect(() => {
    if (palette === undefined) return;

    const paletteBeforeMount = paletteBeforeMountRef.current;

    setRecipeTheme(palette);

    return () => setRecipeTheme(paletteBeforeMount);
  }, [palette, setRecipeTheme]);
}
