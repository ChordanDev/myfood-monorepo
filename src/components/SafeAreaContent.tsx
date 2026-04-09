import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SafeAreaContentProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  includeTop?: boolean;
  includeBottom?: boolean;
  overflowHidden?: boolean;
}

export function SafeAreaContent({
  children,
  style,
  includeTop = true,
  includeBottom = true,
  overflowHidden = true,
}: SafeAreaContentProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        {
          flex: 1,
          paddingTop: includeTop ? insets.top : 0,
          paddingBottom: includeBottom ? insets.bottom : 0,
          overflow: overflowHidden ? 'hidden' : 'visible',
        },
        style,
      ]}>
      {children}
    </View>
  );
}
