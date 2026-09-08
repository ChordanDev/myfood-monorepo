import { StyleProp, Text, TextStyle } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface InputErrorTextProps {
  visible: boolean;
  text: string;
  style?: StyleProp<TextStyle>;
}

export function InputErrorText({ visible, text, style }: InputErrorTextProps) {
  const { theme } = useRecipeTheme();
  // Evita render si no hay error que mostrar.
  if (!visible) {
    return null;
  }

  return (
    <Text
      style={[
        { fontFamily: 'Inter_500Medium', fontSize: 12.25, lineHeight: 17.5 },
        style,
        { color: theme.primaryAccentIntense },
      ]}>
      {text}
    </Text>
  );
}
