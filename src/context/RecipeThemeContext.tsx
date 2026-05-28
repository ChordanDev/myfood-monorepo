import React, { createContext, useContext, useState, ReactNode, useMemo, useCallback } from 'react';
import { RecipeThemeConfig } from '@/types/domain';

interface RecipeThemeContextType {
  theme: RecipeThemeConfig;
  setRecipeTheme: (theme: RecipeThemeConfig | null) => void;
}

const DEFAULT_THEME: RecipeThemeConfig = {
  colorBlack: '#111111',
  colorDark: '#151515',
  colorMedium: '#404040',
  colorLight: '#747474',
  primaryAccent: '#D8D98B',
  appBg: '#C5C5C5',
  icon: '#CFCFCF',
  textBlack: '#1E1E1E',
  textDark: '#1E1E1E',
  textMedium: '#DADADA',
  textLight: '#DADADA',
  primaryAccentIntense: '#FCFF00',
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
      colorBlack: currentTheme.colorBlack || DEFAULT_THEME.colorBlack,
      colorDark: currentTheme.colorDark || DEFAULT_THEME.colorDark,
      colorMedium: currentTheme.colorMedium || DEFAULT_THEME.colorMedium,
      colorLight: currentTheme.colorLight || DEFAULT_THEME.colorLight,
      primaryAccent: currentTheme.primaryAccent || DEFAULT_THEME.primaryAccent,
      appBg: currentTheme.appBg || DEFAULT_THEME.appBg,
      icon: currentTheme.icon || DEFAULT_THEME.icon,
      textBlack: currentTheme.textBlack || DEFAULT_THEME.textBlack,
      textDark: currentTheme.textDark || DEFAULT_THEME.textDark,
      textMedium: currentTheme.textMedium || DEFAULT_THEME.textMedium,
      textLight: currentTheme.textLight || DEFAULT_THEME.textLight,
      primaryAccentIntense: currentTheme.primaryAccentIntense || DEFAULT_THEME.primaryAccentIntense,
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
