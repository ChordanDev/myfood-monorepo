import { Text, View } from 'react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingStepHeadingProps {
  subtitle: string;
  theme: RecipeThemeConfig;
  title: string;
}

export function OnboardingStepHeading({ subtitle, theme, title }: OnboardingStepHeadingProps) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={{
          color: theme.textDark,
          fontFamily: 'Montserrat_700Bold',
          fontSize: 34,
          lineHeight: 40,
        }}>
        {title}
      </Text>
      <Text
        style={{
          color: withOpacity(theme.textBlack, 0.8),
          fontFamily: 'Inter_500Medium',
          fontSize: 15,
          lineHeight: 22,
        }}>
        {subtitle}
      </Text>
    </View>
  );
}
