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

  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: metrics.buttonRadius,
        paddingVertical: metrics.buttonVerticalPadding,
        backgroundColor: isPrimary ? '#899064' : '#242B12',
      }}>
      <Text
        style={{
          fontSize: metrics.buttonFontSize,
          color: isPrimary ? '#242B12' : '#D8D98B',
        }}
        className="font-inter-medium">
        {title}
      </Text>
    </Pressable>
  );
}
