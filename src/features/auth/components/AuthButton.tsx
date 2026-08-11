import { Pressable, Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useThemeColor } from '@/hooks/useThemeColor';

interface AuthButtonProps {
  title: string;
  variant: 'primary' | 'secondary';
  metrics: AuthLandingMetrics;
  testID?: string;
  onPress?: () => void;
  disabled?: boolean;
}

export function AuthButton({
  title,
  variant,
  metrics,
  testID,
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
  const minHeight = Math.max(68, metrics.buttonFontSize + metrics.buttonVerticalPadding * 2);

  return (
    <View
      style={{
        width: '100%',
        marginTop: metrics.buttonTopMargin,
        paddingHorizontal: metrics.horizontalPadding,
      }}>
      <View
        style={{
          width: '100%',
          backgroundColor,
          borderRadius: metrics.buttonRadius,
          opacity: disabled ? 0.55 : 1,
          overflow: 'hidden',
        }}>
        <Pressable
          testID={testID}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ disabled }}
          style={({ pressed }) => ({
            width: '100%',
            minHeight,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? activeBg : 'transparent',
            paddingVertical: metrics.buttonVerticalPadding,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}>
          <Text
            style={{
              width: '100%',
              textAlign: 'center',
              fontSize: metrics.buttonFontSize,
              color: textColor,
            }}
            className="font-inter-medium">
            {title}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
