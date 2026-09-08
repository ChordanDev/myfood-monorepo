import { StyleSheet, Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface SocialDividerProps {
  metrics: AuthLandingMetrics;
  label?: string;
}

export function SocialDivider({ metrics, label = 'Iniciar sesión con' }: SocialDividerProps) {
  const { theme } = useRecipeTheme();
  return (
    <View style={styles.container}>
      <Text
        style={[styles.label, { fontSize: metrics.socialLabelFontSize, color: theme.textMedium }]}>
        {/* Etiqueta sobre las opciones sociales. */}
        {label}
      </Text>
      <View
        style={{
          backgroundColor: theme.primaryAccent,
          height: 1,
          opacity: 0.5,
          width: metrics.socialDividerWidth,
          marginBottom: metrics.socialDividerBottomMargin,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  label: {
    fontFamily: 'Inter_500Medium',
    marginBottom: 10.5,
  },
});
