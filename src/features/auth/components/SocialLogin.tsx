import { AuthLandingMetrics } from '@/utils/responsive';
import { SocialDivider } from './SocialDivider';
import { SocialLoginIcons } from './SocialLoginIcons';
import { View } from 'react-native';

interface SocialLoginProps {
  metrics: AuthLandingMetrics;
}

export function SocialLogin({ metrics }: SocialLoginProps) {
  return (
    <View
      className="items-center"
      style={{
        paddingHorizontal: metrics.horizontalPadding,
        marginBottom: metrics.socialBottomMargin,
      }}>
      <SocialDivider metrics={metrics} />
      <SocialLoginIcons
        iconSize={metrics.socialIconsSize}
        containerSize={metrics.socialIconsContainerSize}
        gap={metrics.socialIconsGap}
      />
    </View>
  );
}
