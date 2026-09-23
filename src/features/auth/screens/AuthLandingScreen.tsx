import { useCallback, useState } from 'react';
import { View, Alert } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth, useAuthResponsiveScale } from '../hooks';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { AUTH_FOOD_IMAGES } from '@/constants/authAssets';
import { GRADIENTS } from '@/constants/theme';
import {
  AuthButton,
  AuthCredentialsForm,
  CarouselImages,
  RegisterEntryModal,
  SocialLogin,
} from '../components';
import { NoisyBackground, SafeAreaContent, TitlePrimary, TopFadeMask } from '@/components';
import { useRouter } from 'expo-router';
import { getAuthErrorMessage } from '@/services/authService';

export function AuthLandingScreen() {
  // Estado local para validacion y modal de registro.
  const { requestVerificationCode } = useAuth();
  const metrics = useAuthResponsiveScale();
  const [isCredentialsValid, setIsCredentialsValid] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [isRequestingLoginCode, setIsRequestingLoginCode] = useState(false);
  const [isRequestingRegisterCode, setIsRequestingRegisterCode] = useState(false);
  const router = useRouter();
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const { inputAnimatedStyle, isKeyboardOpen } = useKeyboardAnimation({
    mode: 'proportional',
    enabled: !showRegisterModal,
  });

  const closeRegisterModal = useCallback(() => {
    setShowRegisterModal(false);
  }, []);

  const openRegisterModal = useCallback(() => {
    setShowRegisterModal(true);
  }, []);

  const handleContinueRegister = useCallback(
    async (email: string) => {
      if (isRequestingRegisterCode) return;

      setIsRequestingRegisterCode(true);
      try {
        const response = await requestVerificationCode(email, 'register');
        setShowRegisterModal(false);
        router.push({
          pathname: '/register',
          params: {
            email,
            flow: 'register',
            cooldown: String(response.resendAvailableInSeconds),
          },
        });
      } catch (error) {
        Alert.alert('Error', getAuthErrorMessage(error));
      } finally {
        setIsRequestingRegisterCode(false);
      }
    },
    [isRequestingRegisterCode, requestVerificationCode, router]
  );

  const handleLogin = useCallback(async () => {
    if (isRequestingLoginCode) return;

    setIsRequestingLoginCode(true);
    try {
      const response = await requestVerificationCode(loginEmail, 'login');
      router.push({
        pathname: '/register',
        params: {
          email: loginEmail,
          flow: 'login',
          cooldown: String(response.resendAvailableInSeconds),
        },
      });
    } catch (error) {
      Alert.alert('Error', getAuthErrorMessage(error));
    } finally {
      setIsRequestingLoginCode(false);
    }
  }, [isRequestingLoginCode, loginEmail, requestVerificationCode, router]);

  // Estabiliza la referencia para evitar re-renders en AuthCredentialsForm.
  const handleCredentialsChange = useCallback(({ email }: { email: string }) => {
    setLoginEmail(email);
  }, []);

  return (
    <LinearGradient
      colors={[...GRADIENTS.authLanding.colors]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[...GRADIENTS.authLanding.locations]}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />

      <SafeAreaContent>
        <View style={{ alignItems: 'center', flex: 5, overflow: 'hidden' }}>
          <TopFadeMask enabled={isKeyboardOpen} fadeSize={50}>
            <View style={{ flex: 1 }}>
              <Animated.View
                style={[
                  { height: '100%', justifyContent: 'space-between', width: '100%' },
                  inputAnimatedStyle,
                ]}>
                <View style={{ alignItems: 'center' }}>
                  {/* Encabezado visual con marca y carrusel. */}
                  <TitlePrimary text="MyFood" metrics={metrics} />
                  <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
                </View>

                <View>
                  {/* Formulario de login con validacion en vivo. */}
                  <AuthCredentialsForm
                    metrics={metrics}
                    onValidityChange={setIsCredentialsValid}
                    onCredentialsChange={handleCredentialsChange}
                  />
                  {/* Navega a verificacion si el email es valido y se envia el codigo. */}
                  <AuthButton
                    title={isRequestingLoginCode ? 'Enviando código...' : 'Iniciar Sesión'}
                    variant="primary"
                    metrics={metrics}
                    testID="e2e-request-login-code"
                    disabled={!isCredentialsValid || isRequestingLoginCode}
                    onPress={handleLogin}
                  />
                </View>
              </Animated.View>
            </View>
          </TopFadeMask>
        </View>

        <View style={{ flex: 3, justifyContent: 'space-between' }}>
          {/* Accesos alternativos al registro y login social. */}
          <AuthButton
            title="Crear una cuenta"
            variant="secondary"
            metrics={metrics}
            onPress={openRegisterModal}
          />
          <SocialLogin metrics={metrics} />
        </View>
      </SafeAreaContent>

      <RegisterEntryModal
        visible={showRegisterModal}
        isSubmitting={isRequestingRegisterCode}
        onClose={closeRegisterModal}
        onContinue={handleContinueRegister}
      />
    </LinearGradient>
  );
}
