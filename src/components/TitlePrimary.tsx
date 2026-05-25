import { Text, View } from 'react-native';
import { TitleMetrics } from '@/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface TitleProps {
  text: string;
  metrics: TitleMetrics;
}

export function TitlePrimary({ text, metrics }: TitleProps) {
  const { theme } = useRecipeTheme();
  return (
    <View
      className="items-center justify-start"
      style={{
        marginBottom: metrics.titleBottomSpacing,
        marginTop: metrics.titleTopSpacing,
      }}>
      {/* Titulo principal ajustado por metricas responsivas. */}
      <Text
        style={{ fontSize: metrics.titleFontSize, color: theme.textDark }}
        className="font-montserrat-bold">
        {text}
      </Text>
    </View>
  );
}
