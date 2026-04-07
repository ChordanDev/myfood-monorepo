import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaContent, NoisyBackground } from '@/components';
import { VerificationActions, VerificationCodeInput } from '../components';
import { useResendCooldown } from '../hooks';

export function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const { secondsLeft, canResend, restart } = useResendCooldown(45);

  const email = useMemo(() => {
    const rawEmail = params.email;
    if (Array.isArray(rawEmail)) {
      return rawEmail[0] ?? '';
    }

    return rawEmail ?? '';
  }, [params.email]);

  const maskedEmail = useMemo(() => {
    const [localPart, domainPart] = email.split('@');
    if (!localPart || !domainPart) {
      return 'tu correo';
    }

    const localHead = localPart.slice(0, 2);
    return `${localHead}***@${domainPart}`;
  }, [email]);

  const handleVerifyCode = () => {
    if (code.length !== 6) {
      Alert.alert('Codigo incompleto', 'Ingresa los 6 digitos para verificar tu cuenta.');
      return;
    }

    Alert.alert('Cuenta verificada', 'Tu correo fue validado correctamente.');
  };

  const handleResendCode = () => {
    if (!canResend) {
      return;
    }

    restart();
    Alert.alert('Codigo reenviado', 'Revisalo en tu correo y vuelve a intentarlo.');
  };

  return (
    <LinearGradient
      colors={['#E5D8C4', '#242B12', '#191D0D', '#111309']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.65, 0.93, 0.98]}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <View className="flex-1 justify-center px-7">
          <Text className="text-center font-montserrat-bold text-[34px] text-[#F7F2E8]">
            Verifica tu correo
          </Text>
          <Text className="font-inter-regular mt-3 text-center text-base text-[#D8D98B]">
            Enviamos un codigo de 6 digitos a {maskedEmail}.
          </Text>

          <VerificationCodeInput value={code} onChange={setCode} />
          <VerificationActions
            secondsLeft={secondsLeft}
            onVerify={handleVerifyCode}
            onResend={handleResendCode}
          />

          <Pressable onPress={() => router.back()} className="mt-6 items-center py-1">
            <Text className="font-inter-regular text-[#F7F2E8]">Cambiar correo</Text>
          </Pressable>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
