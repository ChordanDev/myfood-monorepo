import { Pressable } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PLUS_SVG } from '@/constants/svgIcons';
import { ShadowSurface } from './ShadowSurface';

interface AddCircleButtonProps {
  size?: number;
  onPress?: () => void;
  disabled?: boolean;
}

const DEFAULT_BUTTON_SIZE = 56;

export function AddCircleButton({
  size = DEFAULT_BUTTON_SIZE,
  onPress,
  disabled = false,
}: AddCircleButtonProps) {
  const buttonSize = Math.round(size);
  const radius = Math.round(buttonSize / 2);
  const plusSize = Math.round(buttonSize * 0.55);

  return (
    <ShadowSurface style={{ borderRadius: radius }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Agregar"
        className="items-center justify-center bg-[#1B210E] active:scale-95 active:bg-[#C6C87A]"
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: radius,
          opacity: disabled ? 0.6 : 1,
        }}>
        <SvgXml xml={PLUS_SVG} width={plusSize} height={plusSize} />
      </Pressable>
    </ShadowSurface>
  );
}
