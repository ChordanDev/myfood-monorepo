import { Pressable, Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

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
  const isPrimary = variant === 'primary';
  const buttonBgClass = isPrimary ? 'bg-[#899064]' : 'bg-[#242B12]';
  const textColorClass = isPrimary ? 'text-[#242B12]' : 'text-[#D8D98B]';

  return (
    <View
      style={{ marginTop: metrics.buttonTopMargin, paddingHorizontal: metrics.horizontalPadding }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={`w-full items-center justify-center ${buttonBgClass}`}
        style={{
          borderRadius: metrics.buttonRadius,
          paddingVertical: metrics.buttonVerticalPadding,
          opacity: disabled ? 0.55 : 1,
        }}>
        <Text
          style={{ fontSize: metrics.buttonFontSize }}
          className={`font-inter-medium ${textColorClass}`}>
          {title}
        </Text>
      </Pressable>
    </View>
  );
}
