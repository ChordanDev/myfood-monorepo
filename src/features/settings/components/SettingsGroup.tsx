import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';

interface SettingsGroupProps {
  title: string;
  testID: string;
  /** The rows. A hairline divider is drawn between each pair. */
  children: ReactNode;
}

export function SettingsGroup({ title, testID, children }: SettingsGroupProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorLight });
  const rows = Children.toArray(children);

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View testID={testID} style={[styles.surface, surfaceStyle]}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: withOpacity(theme.textDark, 0.6) }]}>
          {title}
        </Text>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <View
                style={[styles.divider, { backgroundColor: withOpacity(theme.textDark, 0.12) }]}
              />
            ) : null}
            {row}
          </Fragment>
        ))}
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  shadowSurface: {
    borderRadius: 21,
  },
  surface: {
    borderRadius: 21,
    padding: 6,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 18,
    paddingBottom: 8,
    paddingHorizontal: 10,
    paddingTop: 6,
    textTransform: 'uppercase',
  },
});
