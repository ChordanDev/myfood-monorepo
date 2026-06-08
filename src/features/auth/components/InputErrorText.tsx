import { StyleProp, Text, TextStyle } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface InputErrorTextProps {
  visible: boolean;
  text: string;
  className?: string;
  style?: StyleProp<TextStyle>;
}

export function InputErrorText({
  visible,
  text,
  className = 'font-inter-medium text-sm',
  style,
}: InputErrorTextProps) {
  const { theme } = useRecipeTheme();
  // Evita render si no hay error que mostrar.
  if (!visible) {
    return null;
  }

  return (
    <Text className={className} style={[style, { color: theme.primaryAccentIntense }]}>
      {text}
    </Text>
  );
}
