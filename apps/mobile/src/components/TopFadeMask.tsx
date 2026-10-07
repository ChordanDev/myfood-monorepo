import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

interface TopFadeMaskProps {
  children: ReactNode;
  enabled?: boolean;
  fadeSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function TopFadeMask({ children, enabled = true, fadeSize = 50, style }: TopFadeMaskProps) {
  return (
    <MaskedView
      style={[{ flex: 1, width: '100%' }, style]}
      maskElement={
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          {/* Mascara con degradado arriba y opaco abajo. */}
          {enabled ? (
            <>
              <LinearGradient
                colors={['transparent', 'black']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: fadeSize,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: fadeSize,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'black',
                }}
              />
            </>
          ) : (
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'black',
              }}
            />
          )}
        </View>
      }>
      {children}
    </MaskedView>
  );
}
