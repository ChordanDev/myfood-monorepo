import { Pressable, Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AuthButtonProps {
  title: string;
  variant: 'primary' | 'secondary';
  metrics: AuthLandingMetrics;
  onPress?: () => void;
  disabled?: boolean;
}

export function AuthButton({
  title,
  variant,
  metrics,
  onPress,
  disabled = false,
}: AuthButtonProps) {
  const { theme } = useRecipeTheme();
  const { getColorWithOpacity } = useThemeColor();
  // Estilos derivados del variant para evitar duplicacion.
  const isPrimary = variant === 'primary';

  const backgroundColor = isPrimary ? theme.colorLight : theme.colorMedium;
  const textColor = isPrimary ? theme.textBlack : theme.primaryAccent;
  const activeBg = isPrimary
    ? getColorWithOpacity('colorLight', 0.8)
    : getColorWithOpacity('colorMedium', 0.8);

  return (
    <View
      style={{ marginTop: metrics.buttonTopMargin, paddingHorizontal: metrics.horizontalPadding }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
        className="active:scale-97 w-full items-center justify-center"
        style={({ pressed }) => ({
          backgroundColor: pressed ? activeBg : backgroundColor,
          borderRadius: metrics.buttonRadius,
          paddingVertical: metrics.buttonVerticalPadding,
          opacity: disabled ? 0.55 : 1,
        })}>
        <Text
          style={{ fontSize: metrics.buttonFontSize, color: textColor }}
          className="font-inter-medium">
          {title}
        </Text>
      </Pressable>
    </View>
  );
}
