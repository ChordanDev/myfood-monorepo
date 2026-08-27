import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

interface BottomFadeMaskProps {
  children: ReactNode;
  bottomInset?: number;
  enabled?: boolean;
  fadeSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function BottomFadeMask({
  children,
  bottomInset = 0,
  enabled = true,
  fadeSize = 56,
  style,
}: BottomFadeMaskProps) {
  return (
    <MaskedView
      style={[{ flex: 1, width: '100%' }, style]}
      maskElement={
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          {enabled ? (
            <>
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: bottomInset + fadeSize,
                  backgroundColor: 'black',
                }}
              />
              <LinearGradient
                colors={['black', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: bottomInset,
                  height: fadeSize,
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
