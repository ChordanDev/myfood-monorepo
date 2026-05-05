import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, Redirect, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaContent, NoisyBackground } from '@/components';
import { VerificationActions, VerificationCodeInput } from '../components';
import { useResendCooldown, useAuth } from '../hooks';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import {
  getVerificationFlowConfig,
  resolveStringParam,
  resolveVerificationFlow,
} from '../utils/emailCodeVerificationFlow';
import { COLORS } from '@/constants/theme';

export function EmailCodeVerificationScreen() {
  // Obtiene parametros de la ruta para construir el flujo.
  const router = useRouter();
  const { signIn, signUp, sendVerificationCode } = useAuth();
  const params = useLocalSearchParams<{ email?: string | string[]; flow?: string | string[] }>();
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
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

  if (!email) {
    return <Redirect href="/" />;
  }

  const handleVerifyCode = async () => {
    // Bloquea verificacion hasta completar los 6 digitos.
    if (code.length !== 6) {
      Alert.alert('Código incompleto', 'Ingresa los 6 dígitos para verificar tu cuenta.');
      return;
    }

    if (isVerifying) return;

    setIsVerifying(true);

    try {
      // Llama al servicio mock (o real en produccion) segun el flujo.
      if (flow === 'login') {
        await signIn(email, code);
      } else {
        await signUp(email, code);
      }

      Alert.alert(successTitle, successMessage, [
        {
          text: 'OK',
          // La navegacion se maneja automaticamente por el guard en index.tsx
          onPress: () => router.replace(successRedirectPath as Href<string>),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Intenta de nuevo.';
      Alert.alert('Error de verificación', message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendCode = async () => {
    // Respeta el cooldown antes de reenviar.
    if (!canResend) {
      return;
    }

    try {
      await sendVerificationCode(email);
      restart();
      Alert.alert('Código reenviado', resendMessage);
    } catch (error) {
      Alert.alert('Error', 'No se pudo reenviar el código.');
    }
  };

  return (
    <LinearGradient
      colors={['#111309', '#191D0D', '#242B12']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <Animated.View className="h-full w-full justify-between" style={inputAnimatedStyle}>
          <View className="flex-1 justify-center px-7">
            <Text className="text-center font-montserrat-bold text-[34px] text-[#F7F2E8]">
              Verifica tu correo
            </Text>
            <Text className="font-inter-regular mt-3 text-center text-base text-[#D8D98B]">
              Enviamos un código de 6 dígitos a {maskedEmail}.
            </Text>

            <VerificationCodeInput value={code} onChange={setCode} />
            <VerificationActions
              secondsLeft={secondsLeft}
              onVerify={handleVerifyCode}
              onResend={handleResendCode}
            />

            {isVerifying ? (
              <View className="mt-6 items-center py-1">
                <ActivityIndicator size="small" color={COLORS.accentYellow} />
              </View>
            ) : (
              <Pressable onPress={() => router.back()} className="mt-6 items-center py-1">
                <Text className="font-inter-regular text-[#F7F2E8]">Cambiar correo</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
