import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ShoppingCart } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { formatCartButtonLabel } from '../domain';

// Same circle as the add button of Home (`AddCircleButton`): a rotating gradient ring
// around a dark face.
export const SHOPPING_CART_BUTTON_SIZE = 56;

const RING_WIDTH = 3;
const FACE_SIZE = SHOPPING_CART_BUTTON_SIZE - RING_WIDTH * 2;
// Wide enough to cover the circle at any angle of its turn.
const GRADIENT_SIZE = SHOPPING_CART_BUTTON_SIZE * 2.6;
const GRADIENT_OFFSET = -(GRADIENT_SIZE - SHOPPING_CART_BUTTON_SIZE) / 2;
const ICON_SIZE = 26;
const BADGE_SIZE = 22;

export interface ShoppingCartButtonProps {
  // What the cart holds: its rows, and its items that have no row. The badge shows it from one
  // on.
  count: number;
  onPress: () => void;
}

// Floating button that opens the cart. The screen positions it; this only draws it.
export function ShoppingCartButton({ count, onPress }: ShoppingCartButtonProps) {
  const { theme } = useRecipeTheme();
  const rotation = useSharedValue(0);
  const faceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });
  // Body ink on the light surface is a pair every palette keeps readable; the dark border
  // sets the badge apart from the ground and from the cards, which are that same surface.
  const badgeStyle = useAnimatedThemeStyle({
    backgroundColor: theme.colorLight,
    borderColor: theme.colorDark,
  });
  const badgeLabelStyle = useAnimatedThemeStyle({ color: theme.textBlack });

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 3600, easing: Easing.linear }),
      -1,
      false
    );

    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${rotation.value}deg` }],
  }));

  return (
    <ShadowSurface style={styles.surface}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={formatCartButtonLabel(count)}
        style={({ pressed }) => [styles.button, { transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
        <Animated.View style={[styles.ring, ringStyle]}>
          <LinearGradient
            colors={[
              theme.primaryAccentIntense,
              theme.icon,
              theme.primaryAccent,
              theme.primaryAccentIntense,
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View style={[styles.face, faceStyle]}>
          <ShoppingCart size={ICON_SIZE} color={theme.primaryAccent} strokeWidth={2.25} />
        </Animated.View>
      </Pressable>

      {/* A sibling of the button, which clips its children to the circle. The label of the
          button already says the count, so the badge is hidden from screen readers. */}
      {count > 0 ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.badge, badgeStyle]}>
          <Animated.Text style={[styles.badgeLabel, badgeLabelStyle]}>{count}</Animated.Text>
        </Animated.View>
      ) : null}
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 1.5,
    height: BADGE_SIZE,
    justifyContent: 'center',
    minWidth: BADGE_SIZE,
    paddingHorizontal: 5,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  badgeLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  button: {
    alignItems: 'center',
    borderRadius: SHOPPING_CART_BUTTON_SIZE / 2,
    height: SHOPPING_CART_BUTTON_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: SHOPPING_CART_BUTTON_SIZE,
  },
  face: {
    alignItems: 'center',
    borderRadius: FACE_SIZE / 2,
    height: FACE_SIZE,
    justifyContent: 'center',
    width: FACE_SIZE,
  },
  ring: {
    height: GRADIENT_SIZE,
    left: GRADIENT_OFFSET,
    position: 'absolute',
    top: GRADIENT_OFFSET,
    width: GRADIENT_SIZE,
  },
  surface: {
    borderRadius: SHOPPING_CART_BUTTON_SIZE / 2,
  },
});
