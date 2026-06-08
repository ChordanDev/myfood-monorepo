import { Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface SocialDividerProps {
  metrics: AuthLandingMetrics;
  label?: string;
}

export function SocialDivider({ metrics, label = 'Iniciar sesión con' }: SocialDividerProps) {
  const { theme } = useRecipeTheme();
  return (
    <View className="items-center">
      <Text
        style={{ fontSize: metrics.socialLabelFontSize, color: theme.textMedium }}
        className="mb-3 font-inter-medium">
        {/* Etiqueta sobre las opciones sociales. */}
        {label}
      </Text>
      <View
        className="h-px opacity-50"
        style={{
          backgroundColor: theme.primaryAccent,
          width: metrics.socialDividerWidth,
          marginBottom: metrics.socialDividerBottomMargin,
        }}
      />
    </View>
  );
}
