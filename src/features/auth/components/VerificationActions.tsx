import { Pressable, StyleSheet, Text, View } from 'react-native';
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
        style={({ pressed }) => [
          styles.verifyButton,
          {
            backgroundColor: theme.colorLight,
            opacity: isVerifying ? 0.6 : pressed ? 0.9 : 1,
          },
        ]}>
        {/* CTA principal de verificacion. */}
        <Text style={[styles.verifyLabel, { color: theme.colorMedium }]}>
          {isVerifying ? 'Verificando...' : 'Verificar código'}
        </Text>
      </Pressable>

      <Pressable
        disabled={isResending || secondsLeft > 0}
        onPress={onResend}
        style={styles.resendButton}>
        <Text
          style={[
            styles.resendLabel,
            { color: theme.primaryAccent, opacity: isResending ? 0.6 : 1 },
          ]}>
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

const styles = StyleSheet.create({
  resendButton: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 3.5,
  },
  resendLabel: {
    fontFamily: 'Inter_500Medium',
  },
  verifyButton: {
    alignItems: 'center',
    borderRadius: 14,
    marginTop: 17.5,
    paddingVertical: 14,
  },
  verifyLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15.75,
    lineHeight: 24.5,
  },
});
