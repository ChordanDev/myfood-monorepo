import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

const SOFT_SHADOW_STYLE: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.25,
  shadowRadius: 2,
  elevation: 8,
  overflow: 'visible',
};

type ShadowSurfaceProps = PropsWithChildren<ViewProps> & {
  style?: StyleProp<ViewStyle>;
};

export function ShadowSurface({ children, style, ...viewProps }: ShadowSurfaceProps) {
  return (
    <View {...viewProps} collapsable={false} style={[SOFT_SHADOW_STYLE, style]}>
      {children}
    </View>
  );
}
