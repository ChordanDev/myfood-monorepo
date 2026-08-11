import { Pressable, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface VerificationActionsProps {
  secondsLeft: number;
  isVerifying?: boolean;
  isResending?: boolean;
  onVerify: () => void;
  onResend: () => void;
}

export function VerificationActions({
  secondsLeft,
  isVerifying = false,
  isResending = false,
  onVerify,
  onResend,
}: VerificationActionsProps) {
  const { theme } = useRecipeTheme();
  return (
    <View>
      <Pressable
        testID="e2e-verify-code"
        onPress={onVerify}
        disabled={isVerifying}
        className="mt-5 items-center rounded-2xl py-4 active:opacity-90"
        style={{ backgroundColor: theme.colorLight, opacity: isVerifying ? 0.6 : 1 }}>
        {/* CTA principal de verificacion. */}
        <Text className="font-inter-semibold text-lg" style={{ color: theme.colorMedium }}>
          {isVerifying ? 'Verificando...' : 'Verificar código'}
        </Text>
      </Pressable>

      <Pressable
        disabled={isResending || secondsLeft > 0}
        onPress={onResend}
        className="mt-4 items-center py-1">
        <Text
          className="font-inter-medium"
          style={{ color: theme.primaryAccent, opacity: isResending ? 0.6 : 1 }}>
          {/* Accion secundaria con cooldown. */}
          {isResending
            ? 'Reenviando...'
            : secondsLeft > 0
              ? `Reenviar en ${secondsLeft}s`
              : 'Reenviar c\u00f3digo'}
        </Text>
      </Pressable>
    </View>
  );
}
