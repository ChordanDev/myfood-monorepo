import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { Calendar } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

const PILL_RADIUS = 9999;

export interface ShoppingDatePillProps {
  label: string;
}

// Display only: no date picker is designed yet, so the pill is not exposed as a button.
export function ShoppingDatePill({ label }: ShoppingDatePillProps) {
  const { theme } = useRecipeTheme();
  const backgroundStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorBlack });
  const labelStyle = useAnimatedThemeStyle({ color: theme.primaryAccent });

  return (
    <ShadowSurface style={styles.pill}>
      {/* The palette-animated fill is its own layer so the shadow wrapper stays a plain View. */}
      <Animated.View pointerEvents="none" style={[styles.background, backgroundStyle]} />
      <Calendar size={20} color={theme.primaryAccent} strokeWidth={2.5} />
      <Animated.Text style={[styles.label, labelStyle]}>{label}</Animated.Text>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  background: {
    borderRadius: PILL_RADIUS,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    letterSpacing: 0.35,
    lineHeight: 21,
  },
  pill: {
    alignItems: 'center',
    borderRadius: PILL_RADIUS,
    flexDirection: 'row',
    gap: 10.5,
    paddingHorizontal: 17.5,
    paddingVertical: 10.5,
    // Softer than the default surface shadow: the one the Planner header pill casts.
    elevation: 4,
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
