import { TextInput, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface VerificationCodeInputProps {
  value: string;
  onChange: (nextValue: string) => void;
}

export function VerificationCodeInput({ value, onChange }: VerificationCodeInputProps) {
  const { theme } = useRecipeTheme();
  return (
    <View className="mt-8 rounded-2xl" style={{ backgroundColor: theme.icon }}>
      <TextInput
        value={value}
        // Filtra a 6 digitos y evita caracteres no numericos.
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, '').slice(0, 6))}
        placeholder="123456"
        placeholderTextColor={theme.textLight}
        keyboardType="number-pad"
        textAlign="center"
        accessibilityLabel="Código de verificación"
        accessibilityHint="Ingresa el código de 6 dígitos enviado a tu correo"
        className="py-4 font-inter-semibold text-2xl tracking-[6px]"
        style={{ color: theme.colorMedium }}
      />
    </View>
  );
}
