import { Pressable, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface VerificationActionsProps {
  secondsLeft: number;
  onVerify: () => void;
  onResend: () => void;
}

export function VerificationActions({ secondsLeft, onVerify, onResend }: VerificationActionsProps) {
  const { theme } = useRecipeTheme();
  return (
    <View>
      <Pressable
        onPress={onVerify}
        className="mt-5 items-center rounded-2xl py-4 active:opacity-90"
        style={{ backgroundColor: theme.colorLight }}>
        {/* CTA principal de verificacion. */}
        <Text className="font-inter-semibold text-lg" style={{ color: theme.colorMedium }}>
          Verificar código
        </Text>
      </Pressable>

      <Pressable onPress={onResend} className="mt-4 items-center py-1">
        <Text className="font-inter-medium" style={{ color: theme.primaryAccent }}>
          {/* Accion secundaria con cooldown. */}
          {secondsLeft > 0 ? `Reenviar en ${secondsLeft}s` : 'Reenviar c\u00f3digo'}
        </Text>
      </Pressable>
    </View>
  );
}
