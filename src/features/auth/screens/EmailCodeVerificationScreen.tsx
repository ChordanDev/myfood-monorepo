import { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaContent, NoisyBackground } from '@/components';
import { VerificationActions, VerificationCodeInput } from '../components';
import { useResendCooldown } from '../hooks';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import {
  getVerificationFlowConfig,
  resolveStringParam,
  resolveVerificationFlow,
} from '../utils/emailCodeVerificationFlow';

export function EmailCodeVerificationScreen() {
  // Obtiene parametros de la ruta para construir el flujo.
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string | string[]; flow?: string | string[] }>();
  const [code, setCode] = useState('');
  const { secondsLeft, canResend, restart } = useResendCooldown(45);
  const { inputAnimatedStyle } = useKeyboardAnimation();

  const email = useMemo(() => resolveStringParam(params.email), [params.email]);
  const flow = useMemo(() => resolveVerificationFlow(params.flow), [params.flow]);
  const { successTitle, successMessage, resendMessage, successRedirectPath } = useMemo(
    () => getVerificationFlowConfig(flow),
    [flow]
  );

  const maskedEmail = useMemo(() => {
    const [localPart, domainPart] = email.split('@');
    if (!localPart || !domainPart) {
      return 'tu correo';
    }

    const localHead = localPart.slice(0, 2);
    return `${localHead}***@${domainPart}`;
  }, [email]);

  const handleVerifyCode = () => {
    // Bloquea verificacion hasta completar los 6 digitos.
    if (code.length !== 6) {
      Alert.alert('C\u00f3digo incompleto', 'Ingresa los 6 d\u00edgitos para verificar tu cuenta.');
      return;
    }

    Alert.alert(successTitle, successMessage, [
      {
        text: 'OK',
        onPress: () => router.replace(successRedirectPath),
      },
    ]);
  };

  const handleResendCode = () => {
    // Respeta el cooldown antes de reenviar.
    if (!canResend) {
      return;
    }

    restart();
    Alert.alert('C\u00f3digo reenviado', resendMessage);
  };

  return (
    <LinearGradient
      colors={['#111309', '#191D0D', '#242B12']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.16} />
      <SafeAreaContent>
        <Animated.View className="h-full w-full justify-between" style={inputAnimatedStyle}>
          <View className="flex-1 justify-center px-7">
            <Text className="text-center font-montserrat-bold text-[34px] text-[#F7F2E8]">
              Verifica tu correo
            </Text>
            <Text className="font-inter-regular mt-3 text-center text-base text-[#D8D98B]">
              Enviamos un c\u00f3digo de 6 d\u00edgitos a {maskedEmail}.
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
        </Animated.View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
