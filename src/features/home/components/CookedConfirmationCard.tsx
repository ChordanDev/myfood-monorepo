import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Check, X } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import type { HomeMetrics } from '../utils/responsive';

interface CookedConfirmationCardProps {
  metrics: HomeMetrics;
  onConfirmCooked: () => void;
  onConfirmSkipped: () => void;
}

interface ConfirmationButtonProps {
  label: string;
  size: number;
  onPress: () => void;
  children: ReactNode;
}

function ConfirmationButton({ label, size, onPress, children }: ConfirmationButtonProps) {
  const { theme } = useRecipeTheme();
  const circleStyle = useAnimatedThemeStyle({
    backgroundColor: theme.colorMedium,
    borderColor: withOpacity(theme.icon, 0.3),
  });

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.95 : 1 }] })}>
      <Animated.View
        style={[
          styles.buttonCircle,
          { width: size, height: size, borderRadius: size / 2 },
          circleStyle,
        ]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export function CookedConfirmationCard({
  metrics,
  onConfirmCooked,
  onConfirmSkipped,
}: CookedConfirmationCardProps) {
  const { theme } = useRecipeTheme();
  const borderRadius = metrics.pendingCardRadius;
  const buttonSize = metrics.confirmButtonSize;
  const iconSize = Math.round(buttonSize * 0.55);
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorBlack });
  const questionStyle = useAnimatedThemeStyle({ color: theme.textLight });

  return (
    <ShadowSurface style={[styles.fill, { borderRadius }]}>
      <Animated.View
        style={[
          styles.fill,
          styles.surface,
          { borderRadius, paddingVertical: metrics.sectionGap },
          surfaceStyle,
        ]}>
        <Animated.Text
          style={[
            styles.question,
            {
              fontSize: metrics.foodCardLabelFontSize,
              lineHeight: metrics.foodCardDescriptionLineHeight,
            },
            questionStyle,
          ]}>
          ¿Hiciste esta receta?
        </Animated.Text>
        <View style={[styles.actions, { gap: metrics.sectionGap }]}>
          <ConfirmationButton label="Sí, la cociné" size={buttonSize} onPress={onConfirmCooked}>
            <Check size={iconSize} color={theme.primaryAccent} strokeWidth={2.5} />
          </ConfirmationButton>
          <ConfirmationButton label="No la cociné" size={buttonSize} onPress={onConfirmSkipped}>
            <X size={iconSize} color={theme.alert} strokeWidth={2.5} />
          </ConfirmationButton>
        </View>
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonCircle: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
  },
  fill: {
    flex: 1,
    width: '100%',
  },
  question: {
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  surface: {
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 14,
  },
});
