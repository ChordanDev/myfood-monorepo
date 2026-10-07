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
  const minHeight = Math.max(44, metrics.buttonFontSize + metrics.buttonVerticalPadding * 2);

  return (
    <View
      style={{
        width: '100%',
        minHeight,
        flexShrink: 0,
        marginTop: metrics.buttonTopMargin,
        paddingHorizontal: metrics.horizontalPadding,
      }}>
      <View
        style={{
          width: '100%',
          height: minHeight,
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
            height: minHeight,
            backgroundColor: pressed ? activeBg : 'transparent',
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}>
          <View
            style={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text
              style={{
                textAlign: 'center',
                includeFontPadding: false,
                fontSize: metrics.buttonFontSize,
                fontFamily: 'Inter_500Medium',
                lineHeight: Math.round(metrics.buttonFontSize * 1.2),
                color: textColor,
              }}>
              {title}
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
