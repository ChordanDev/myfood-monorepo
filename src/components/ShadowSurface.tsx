import type { PropsWithChildren } from 'react';
import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';
import { COLORS } from '@/constants/theme';

const SOFT_SHADOW_STYLE: ViewStyle = {
  shadowColor: COLORS.shadow,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 2,
  // Android solo usa elevation; los shadow* props son para iOS.
  elevation: 8,
  overflow: 'visible',
};

type ShadowSurfaceProps = PropsWithChildren<ViewProps> & {
  style?: StyleProp<ViewStyle>;
  className?: string;
};

export function ShadowSurface({ children, style, className, ...viewProps }: ShadowSurfaceProps) {
  return (
    <View className={className} style={[SOFT_SHADOW_STYLE, style]} {...viewProps}>
      {children}
    </View>
  );
}
