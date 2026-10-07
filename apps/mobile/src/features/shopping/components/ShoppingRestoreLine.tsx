import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { formatRemovedLabel } from '../domain';

export interface ShoppingRestoreLineProps {
  removedCount: number;
  onRestore: () => void;
}

// The only trace of the removed rows, and the way to bring all of them back.
export function ShoppingRestoreLine({ removedCount, onRestore }: ShoppingRestoreLineProps) {
  const { theme } = useRecipeTheme();
  const labelStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });
  const label = formatRemovedLabel(removedCount);

  return (
    <Pressable
      onPress={onRestore}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
      <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  line: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  pressed: {
    opacity: 0.6,
  },
});
