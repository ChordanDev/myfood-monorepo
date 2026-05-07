import { Pressable, View } from 'react-native';
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
    <View className="flex-row items-center justify-center" style={{ gap }}>
      <Pressable
        className="items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Google"
        style={{ width: containerSize, height: containerSize }}>
        <SvgXml xml={GOOGLE_SVG} width={iconSize} height={iconSize} />
      </Pressable>
      <Pressable
        className="items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Facebook"
        style={{ width: containerSize, height: containerSize }}>
        <SvgXml xml={FACEBOOK_SVG} width={iconSize} height={iconSize} />
      </Pressable>
      <Pressable
        className="items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel="Iniciar sesión con Apple"
        style={{ width: containerSize, height: containerSize }}>
        <SvgXml xml={APPLE_SVG} width={iconSize} height={iconSize} />
      </Pressable>
    </View>
  );
}
