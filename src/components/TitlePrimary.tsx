import { View } from 'react-native';
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
      className="items-center justify-start"
      style={{
        marginBottom: metrics.titleBottomSpacing,
        marginTop: metrics.titleTopSpacing,
      }}>
      {/* Titulo principal ajustado por metricas responsivas. */}
      <Animated.Text
        style={[{ fontSize: metrics.titleFontSize }, titleStyle]}
        className="font-montserrat-bold">
        {text}
      </Animated.Text>
    </View>
  );
}
