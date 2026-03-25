import { Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

interface SocialDividerProps {
  metrics: AuthLandingMetrics;
  label?: string;
}

export function SocialDivider({ metrics, label = 'Iniciar sesión con' }: SocialDividerProps) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text
        style={{
          marginBottom: 12,
          fontSize: metrics.socialLabelFontSize,
          color: '#cbd8aa',
        }}
        className="font-inter-medium">
        {label}
      </Text>
      <View
        style={{
          width: metrics.socialDividerWidth,
          height: 1,
          marginBottom: metrics.socialDividerBottomMargin,
          backgroundColor: '#D8D98B',
          opacity: 0.5,
        }}
      />
    </View>
  );
}
