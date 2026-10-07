import { Pressable, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { APPLE_SVG, FACEBOOK_SVG, GOOGLE_SVG } from '@/constants/svgIcons';

interface SocialLoginIconsProps {
  iconSize?: number;
  containerSize?: number;
  gap?: number;
}

export function SocialLoginIcons({
  iconSize = 39,
  containerSize = 48,
  gap = 64,
}: SocialLoginIconsProps) {
  return (
    <View style={[styles.container, { gap }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Google"
        style={[styles.button, { width: containerSize, height: containerSize }]}>
        <SvgXml xml={GOOGLE_SVG} width={iconSize} height={iconSize} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Facebook"
        style={[styles.button, { width: containerSize, height: containerSize }]}>
        <SvgXml xml={FACEBOOK_SVG} width={iconSize} height={iconSize} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Apple"
        style={[styles.button, { width: containerSize, height: containerSize }]}>
        <SvgXml xml={APPLE_SVG} width={iconSize} height={iconSize} />
      </Pressable>
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
