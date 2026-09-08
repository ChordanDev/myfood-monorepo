import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TitleMetrics } from '@/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';

interface TitleProps {
  text: string;
  metrics: TitleMetrics;
}

export function TitlePrimary({ text, metrics }: TitleProps) {
  const { theme } = useRecipeTheme();
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });

  return (
    <View
      style={[
        styles.container,
        {
          marginBottom: metrics.titleBottomSpacing,
          marginTop: metrics.titleTopSpacing,
        },
      ]}>
      {/* Titulo principal ajustado por metricas responsivas. */}
      <Animated.Text style={[styles.title, { fontSize: metrics.titleFontSize }, titleStyle]}>
        {text}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
  },
});
