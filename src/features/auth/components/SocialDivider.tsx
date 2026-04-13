import { Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

interface SocialDividerProps {
  metrics: AuthLandingMetrics;
  label?: string;
}

export function SocialDivider({ metrics, label = 'Iniciar sesión con' }: SocialDividerProps) {
  return (
    <View className="items-center">
      <Text
        style={{ fontSize: metrics.socialLabelFontSize }}
        className="mb-3 font-inter-medium text-[#cbd8aa]">
        {/* Etiqueta sobre las opciones sociales. */}
        {label}
      </Text>
      <View
        className="h-px bg-[#D8D98B] opacity-50"
        style={{
          width: metrics.socialDividerWidth,
          marginBottom: metrics.socialDividerBottomMargin,
        }}
      />
    </View>
  );
}
