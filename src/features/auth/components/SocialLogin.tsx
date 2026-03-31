import { SocialDivider } from './SocialDivider';
import { SocialLoginIcons } from './SocialLoginIcons';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';
import { View } from 'react-native';

export function SocialLogin() {
  const metrics = useResponsiveScale();

  return (
    <View
      className="items-center justify-end"
      style={{
        paddingHorizontal: metrics.horizontalPadding,
        paddingBottom: metrics.socialBottomPadding,
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
