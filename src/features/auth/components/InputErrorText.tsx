import { StyleProp, Text, TextStyle } from 'react-native';

interface InputErrorTextProps {
  visible: boolean;
  text: string;
  className?: string;
  style?: StyleProp<TextStyle>;
}

export function InputErrorText({
  visible,
  text,
  className = 'font-inter-medium text-sm text-[#8A1F1F]',
  style,
}: InputErrorTextProps) {
  // Evita render si no hay error que mostrar.
  if (!visible) {
    return null;
  }

  return (
    <Text className={className} style={style}>
      {text}
    </Text>
  );
}
