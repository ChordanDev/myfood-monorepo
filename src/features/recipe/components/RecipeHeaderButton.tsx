import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RECIPE_HEADER_HEIGHT } from '../constants';

interface RecipeHeaderButtonProps {
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** Set on toggles, so assistive tech announces the current state. */
  selected?: boolean;
}

const DISABLED_OPACITY = 0.4;
// Buttons sit 10pt apart: a 4pt slop widens the target without overlapping its neighbor.
const HIT_SLOP = 4;

export function RecipeHeaderButton({
  testID,
  accessibilityLabel,
  onPress,
  children,
  disabled = false,
  selected,
}: RecipeHeaderButtonProps) {
  const { theme } = useRecipeTheme();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor: theme.colorBlack, opacity: disabled ? DISABLED_OPACITY : 1 },
      ]}>
      {children}
    </Pressable>
  );
}

export const recipeHeaderShadow = {
  elevation: 4,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 3,
} as const;

const styles = StyleSheet.create({
  button: {
    ...recipeHeaderShadow,
    alignItems: 'center',
    borderRadius: 9999,
    height: RECIPE_HEADER_HEIGHT,
    justifyContent: 'center',
    width: RECIPE_HEADER_HEIGHT,
  },
});
