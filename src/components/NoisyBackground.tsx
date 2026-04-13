import { ImageBackground, Platform, StyleProp, ViewStyle } from 'react-native';

interface NoisyBackgroundProps {
  opacity?: number;
  style?: StyleProp<ViewStyle>;
}

export function NoisyBackground({ opacity = 0.2, style }: NoisyBackgroundProps) {
  return (
    <ImageBackground
      // Textura de ruido para dar profundidad visual al fondo.
      source={require('../../assets/noisy-background.jpg')}
      resizeMode={Platform.OS === 'ios' ? 'cover' : 'repeat'}
      style={[
        {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity,
        },
        style,
      ]}
    />
  );
}
