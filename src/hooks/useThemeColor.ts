import { useCallback } from 'react';
import { withOpacity } from '@/utils/colors';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RecipeThemeConfig } from '@/types/domain';

/**
 * Hook para aplicar opacidad a los colores del theme actual de la receta.
 * Permite pasar un nombre de color del theme (ej: 'primaryAccent') o un color hardcodeado.
 */
export function useThemeColor() {
  const { theme } = useRecipeTheme();

  /**
   * Obtiene un color del theme con la opacidad aplicada.
   * @param colorKey O bien una key de RecipeThemeConfig o un string de color hex/rgb
   * @param opacity Valor de 0 a 1
   */
  const getColorWithOpacity = useCallback(
    (colorKey: keyof RecipeThemeConfig | string, opacity: number = 1) => {
      // Si es una key del theme, usamos ese valor. Si no, asumimos que es un color hardcodeado.
      const baseColor = (theme as any)[colorKey] || colorKey;
      return withOpacity(baseColor, opacity);
    },
    [theme]
  );

  return { getColorWithOpacity, theme };
}
