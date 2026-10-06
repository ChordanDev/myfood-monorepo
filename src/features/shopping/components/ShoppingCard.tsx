import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

// Space between the header and the first row of a card.
export const SHOPPING_CARD_HEADER_GAP = 6;

// Touch slop of a 24 pt header control. Below it the slop stops at the first row, which would
// otherwise win the overlap and take a tap meant for the header; `top` sets how far it
// reaches upwards, into the padding of the card.
export function getHeaderControlHitSlop(top: number) {
  return { top, right: 10, bottom: SHOPPING_CARD_HEADER_GAP, left: 10 };
}

export interface ShoppingCardProps {
  title: string;
  // Control pushed to the right of the title: "Marcar todos", or the add button.
  headerAction?: ReactNode;
  children: ReactNode;
}

// Light surface shared by every card of the list: a title, an optional control, the rows.
export function ShoppingCard({ title, headerAction, children }: ShoppingCardProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View style={[styles.surface, surfaceStyle]}>
        <View style={styles.header}>
          <Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>
            {title}
          </Animated.Text>
          {headerAction}
        </View>
        {children}
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: SHOPPING_CARD_HEADER_GAP,
  },
  shadowSurface: {
    borderRadius: 24,
  },
  surface: {
    borderRadius: 21,
    paddingBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 23,
  },
});
