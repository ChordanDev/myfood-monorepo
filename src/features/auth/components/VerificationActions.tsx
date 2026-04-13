import { Pressable, Text, View } from 'react-native';

interface VerificationActionsProps {
  secondsLeft: number;
  onVerify: () => void;
  onResend: () => void;
}

export function VerificationActions({ secondsLeft, onVerify, onResend }: VerificationActionsProps) {
  return (
    <View>
      <Pressable
        onPress={onVerify}
        className="mt-5 items-center rounded-2xl bg-[#899064] py-4 active:opacity-90">
        {/* CTA principal de verificacion. */}
        <Text className="font-inter-semibold text-lg text-[#242B12]">Verificar código</Text>
      </Pressable>

      <Pressable onPress={onResend} className="mt-4 items-center py-1">
        <Text className="font-inter-medium text-[#D8D98B]">
          {/* Accion secundaria con cooldown. */}
          {secondsLeft > 0 ? `Reenviar en ${secondsLeft}s` : 'Reenviar c\u00f3digo'}
        </Text>
      </Pressable>
    </View>
  );
}
