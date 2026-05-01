import { TextInput, View } from 'react-native';

interface VerificationCodeInputProps {
  value: string;
  onChange: (nextValue: string) => void;
}

export function VerificationCodeInput({ value, onChange }: VerificationCodeInputProps) {
  return (
    <View className="mt-8 rounded-2xl bg-[#E5D8C4]">
      <TextInput
        value={value}
        // Filtra a 6 digitos y evita caracteres no numericos.
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, '').slice(0, 6))}
        placeholder="123456"
        placeholderTextColor="#6F735E"
        keyboardType="number-pad"
        textAlign="center"
        accessibilityLabel="Código de verificación"
        accessibilityHint="Ingresa el código de 6 dígitos enviado a tu correo"
        className="py-4 font-inter-semibold text-2xl tracking-[6px] text-[#242B12]"
      />
    </View>
  );
}
