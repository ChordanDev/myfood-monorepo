import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';
import { RecipeThemeConfig } from '@/types/domain';
import { COLORS, GRADIENTS } from '@/constants/theme';

interface RecipeThemeContextType {
  theme: RecipeThemeConfig;
  setRecipeTheme: (theme: RecipeThemeConfig | null) => void;
}

const DEFAULT_THEME: RecipeThemeConfig = {
  foodCardGradient: ['#364025', '#1B210E'],
  primaryAccent: '#D8D98B',
  appBgGradient: ['#17180E', '#565A41', '#D6C4B1'],
  calendarBg: COLORS.bgMedium,
  calendarDayActive: COLORS.accentYellow,
  textMain: COLORS.textLight,
};

const RecipeThemeContext = createContext<RecipeThemeContextType | undefined>(undefined);

export function RecipeThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Partial<RecipeThemeConfig> | null>(null);

  // Merge seguro para asegurar que siempre haya valores válidos
  const theme = useMemo(() => {
    if (!currentTheme) return DEFAULT_THEME;
    return {
      ...DEFAULT_THEME,
      ...currentTheme,
      // Asegurar que los arrays tengan el tamaño correcto
      foodCardGradient: currentTheme.foodCardGradient ?? DEFAULT_THEME.foodCardGradient,
      appBgGradient: currentTheme.appBgGradient ?? DEFAULT_THEME.appBgGradient,
    };
  }, [currentTheme]);

  const setRecipeTheme = useCallback((newTheme: RecipeThemeConfig | null) => {
    setCurrentTheme((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(newTheme)) return prev;
      return newTheme;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setRecipeTheme,
    }),
    [theme, setRecipeTheme]
  );

  return <RecipeThemeContext.Provider value={value}>{children}</RecipeThemeContext.Provider>;
}

export function useRecipeTheme() {
  const context = useContext(RecipeThemeContext);
  if (context === undefined) {
    throw new Error('useRecipeTheme must be used within a RecipeThemeProvider');
  }
  return context;
}
