import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
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
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { getAuthErrorMessage } from '@/services/authService';

export function EmailCodeVerificationScreen() {
  const { theme } = useRecipeTheme();
  // Obtiene parametros de la ruta para construir el flujo.
  const router = useRouter();
  const { signIn, signUp, requestVerificationCode } = useAuth();
  const params = useLocalSearchParams<{
    email?: string | string[];
    flow?: string | string[];
    cooldown?: string | string[];
  }>();
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const initialCooldown = useMemo(() => {
    const rawCooldown = Number(resolveStringParam(params.cooldown));
    return Number.isFinite(rawCooldown) && rawCooldown > 0 ? rawCooldown : 45;
  }, [params.cooldown]);
  const { secondsLeft, canResend, restart } = useResendCooldown(initialCooldown);
  const { inputAnimatedStyle } = useKeyboardAnimation({ mode: 'proportional' });

  const email = useMemo(() => resolveStringParam(params.email), [params.email]);
  const flow = useMemo(() => resolveVerificationFlow(params.flow), [params.flow]);
  const { successTitle, successMessage, resendMessage } = useMemo(
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
          // La navegacion se maneja automaticamente por el gate en index.tsx.
          onPress: () => router.replace('/'),
        },
      ]);
    } catch (error) {
      Alert.alert('Error de verificación', getAuthErrorMessage(error));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResendCode = async () => {
    // Respeta el cooldown antes de reenviar.
    if (!canResend || isResending) {
      return;
    }

    setIsResending(true);
    try {
      const response = await requestVerificationCode(email, flow);
      restart(response.resendAvailableInSeconds);
      Alert.alert('Código reenviado', resendMessage);
    } catch (error) {
      Alert.alert('Error', getAuthErrorMessage(error));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <LinearGradient
      colors={[theme.colorBlack, theme.colorDark, theme.colorMedium]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <Animated.View style={[styles.animatedContent, inputAnimatedStyle]}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: theme.textBlack }]}>Verifica tu correo</Text>
            <Text style={[styles.subtitle, { color: theme.primaryAccent }]}>
              Enviamos un código de 6 dígitos a {maskedEmail}.
            </Text>

            <VerificationCodeInput value={code} onChange={setCode} />
            <VerificationActions
              secondsLeft={secondsLeft}
              isVerifying={isVerifying}
              isResending={isResending}
              onVerify={handleVerifyCode}
              onResend={handleResendCode}
            />

            {isVerifying ? (
              <View style={styles.backAction}>
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              </View>
            ) : (
              <Pressable onPress={() => router.back()} style={styles.backAction}>
                <Text style={[styles.backLabel, { color: theme.textBlack }]}>Cambiar correo</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      </SafeAreaContent>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  animatedContent: {
    height: '100%',
    justifyContent: 'space-between',
    width: '100%',
  },
  backAction: {
    alignItems: 'center',
    marginTop: 21,
    paddingVertical: 3.5,
  },
  backLabel: {
    fontFamily: 'Inter_400Regular',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24.5,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10.5,
    textAlign: 'center',
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 34,
    textAlign: 'center',
  },
});
