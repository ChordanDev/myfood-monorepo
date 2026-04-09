import { Text, View } from 'react-native';
import { AuthLandingMetrics } from '@/utils/responsive';

interface TitleProps {
  text: string;
  metrics: AuthLandingMetrics;
}

export function TitlePrimary({ text, metrics }: TitleProps) {
  return (
    <View
      className="items-center justify-start"
      style={{
        marginBottom: metrics.titleBottomSpacing,
        marginTop: metrics.titleTopSpacing,
      }}>
      <Text
        style={{ fontSize: metrics.titleFontSize, color: '#242B12' }}
        className="font-montserrat-bold">
        {text}
      </Text>
    </View>
  );
}

export default TitlePrimary;
