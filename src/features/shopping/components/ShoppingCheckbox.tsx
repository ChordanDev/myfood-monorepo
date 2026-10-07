import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';

export interface ShoppingCheckboxProps {
  checked: boolean;
}

// Presentational only: the row or header that wraps it owns the press and the accessibility.
export function ShoppingCheckbox({ checked }: ShoppingCheckboxProps) {
  const { theme } = useRecipeTheme();
  // The empty box is the accent at zero opacity, so both states animate the same properties.
  const boxStyle = useAnimatedThemeStyle(
    {
      backgroundColor: withOpacity(theme.primaryAccent, checked ? 0.7 : 0),
      borderColor: checked ? theme.primaryAccent : theme.colorMedium,
    },
    // Checking is a state change, not a palette change: it must not crossfade.
    { immediateKey: checked }
  );

  return (
    <Animated.View testID="shopping-checkbox" style={[styles.box, boxStyle]}>
      {checked ? <Check size={14} color={theme.textBlack} strokeWidth={3} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
});
