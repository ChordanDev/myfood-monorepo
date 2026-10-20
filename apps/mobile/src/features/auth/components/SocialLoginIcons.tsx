import { Pressable, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { APPLE_SVG, GOOGLE_SVG } from '@/constants/svgIcons';
import type { SocialProvider } from '../types/auth';

const PROVIDER_BUTTONS: Record<SocialProvider, { label: string; xml: string }> = {
  google: { label: 'Iniciar sesión con Google', xml: GOOGLE_SVG },
  apple: { label: 'Iniciar sesión con Apple', xml: APPLE_SVG },
};

interface SocialLoginIconsProps {
  providers: SocialProvider[];
  onPress: (provider: SocialProvider) => void;
  disabled?: boolean;
  iconSize?: number;
  containerSize?: number;
  gap?: number;
}

export function SocialLoginIcons({
  providers,
  onPress,
  disabled = false,
  iconSize = 39,
  containerSize = 48,
  gap = 64,
}: SocialLoginIconsProps) {
  return (
    <View style={[styles.container, { gap }]}>
      {providers.map((provider) => (
        <Pressable
          key={provider}
          testID={`e2e-social-${provider}`}
          accessibilityRole="button"
          accessibilityLabel={PROVIDER_BUTTONS[provider].label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onPress(provider)}
          style={[
            styles.button,
            { width: containerSize, height: containerSize, opacity: disabled ? 0.55 : 1 },
          ]}>
          <SvgXml xml={PROVIDER_BUTTONS[provider].xml} width={iconSize} height={iconSize} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
});
