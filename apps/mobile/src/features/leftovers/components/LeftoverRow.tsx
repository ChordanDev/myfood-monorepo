import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { formatConsumeBy, formatPortions } from '../domain';
import type { PreparedLeftover } from '../types';

export interface LeftoverRowProps {
  leftover: PreparedLeftover;
  disabled: boolean;
  onConsume: (id: string) => void;
  onDiscard: (id: string) => void;
}

export function LeftoverRow({ leftover, disabled, onConsume, onDiscard }: LeftoverRowProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const metaStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const primaryStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });
  const primaryLabelStyle = useAnimatedThemeStyle({ color: theme.textLight });
  const secondaryLabelStyle = useAnimatedThemeStyle({ color: theme.textDark });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <Animated.Text style={[styles.title, titleStyle]}>{leftover.title}</Animated.Text>
        <Animated.Text style={[styles.meta, metaStyle]}>
          {`${formatPortions(leftover.portions)} · Consumir antes del ${formatConsumeBy(leftover.consumeByDate)}`}
        </Animated.Text>
        {leftover.notes ? (
          <Animated.Text style={[styles.meta, metaStyle]}>{leftover.notes}</Animated.Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Comer ${leftover.title}`}
            disabled={disabled}
            onPress={() => onConsume(leftover.id)}
            style={({ pressed }) => (pressed || disabled) && styles.pressed}>
            <Animated.View style={[styles.button, primaryStyle]}>
              <Animated.Text style={[styles.label, primaryLabelStyle]}>Comer</Animated.Text>
            </Animated.View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Descartar ${leftover.title}`}
            disabled={disabled}
            onPress={() => onDiscard(leftover.id)}
            style={({ pressed }) => (pressed || disabled) && styles.pressed}>
            <Animated.View style={styles.button}>
              <Animated.Text style={[styles.label, secondaryLabelStyle]}>Descartar</Animated.Text>
            </Animated.View>
          </Pressable>
        </View>
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  pressed: { opacity: 0.5 },
  shadowSurface: { borderRadius: 24 },
  surface: { borderRadius: 21, gap: 4, padding: 16 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 17, lineHeight: 22 },
});
