import { Pressable, Text } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

interface AuthButtonProps {
  title: string;
  variant: 'primary' | 'secondary';
  metrics: AuthLandingMetrics;
  onPress?: () => void;
}

export function AuthButton({ title, variant, metrics, onPress }: AuthButtonProps) {
  const isPrimary = variant === 'primary';
  const buttonBgClass = isPrimary ? 'bg-[#899064]' : 'bg-[#242B12]';
  const textColorClass = isPrimary ? 'text-[#242B12]' : 'text-[#D8D98B]';

  return (
    <Pressable
      onPress={onPress}
      className={`w-full items-center justify-center ${buttonBgClass}`}
      style={{
        borderRadius: metrics.buttonRadius,
        paddingVertical: metrics.buttonVerticalPadding,
      }}>
      <Text
        style={{ fontSize: metrics.buttonFontSize }}
        className={`font-inter-medium ${textColorClass}`}>
        {title}
      </Text>
    </Pressable>
  );
}
