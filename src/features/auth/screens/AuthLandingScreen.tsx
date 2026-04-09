import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { AUTH_FOOD_IMAGES } from '@/constants/authAssets';
import {
  AuthButton,
  AuthCredentialsForm,
  CarouselImages,
  RegisterEntryModal,
  SocialLogin,
} from '../components';
import { NoisyBackground, SafeAreaContent, TitlePrimary, TopFadeMask } from '../../../components';
import { useRouter } from 'expo-router';

export function AuthLandingScreen() {
  const router = useRouter();
  const metrics = useResponsiveScale();
  const [isCredentialsValid, setIsCredentialsValid] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const { formAnimatedStyle, isKeyboardOpen } = useKeyboardAnimation({
    enabled: !showRegisterModal,
  });

  const closeRegisterModal = () => {
    setShowRegisterModal(false);
  };

  const openRegisterModal = () => {
    setShowRegisterModal(true);
  };

  const handleContinueRegister = (email: string) => {
    closeRegisterModal();
    router.push({ pathname: '/register', params: { email, flow: 'register' } });
  };

  const handleContinueLogin = () => {
    router.push({ pathname: '/register', params: { email: loginEmail, flow: 'login' } });
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
        {/* Sección de título y carousel, envuelta en máscara de desvanecimiento al levantar teclado */}
        <View className="items-center" style={{ flex: 5, overflow: 'hidden' }}>
          <TopFadeMask enabled={isKeyboardOpen} fadeSize={50}>
            <View className="flex-1">
              <Animated.View className="h-full w-full justify-between" style={formAnimatedStyle}>
                <View className="items-center">
                  {/* TÍTULO */}
                  <TitlePrimary text="MyFood" metrics={metrics} />

                  {/* CAROUSEL DE IMÁGENES */}
                  <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
                </View>

                <View>
                  {/* FORMULARIO DE CREDENCIALES */}
                  <AuthCredentialsForm
                    metrics={metrics}
                    onValidityChange={setIsCredentialsValid}
                    onCredentialsChange={({ email }) => setLoginEmail(email)}
                  />
                  {/* BOTÓN DE INICIAR SESIÓN */}
                  <AuthButton
                    title="Iniciar Sesión"
                    variant="primary"
                    metrics={metrics}
                    disabled={!isCredentialsValid}
                    onPress={handleContinueLogin}
                  />
                </View>
              </Animated.View>
            </View>
          </TopFadeMask>
        </View>

        {/* Sección botones y opciones sociales */}
        <View className="justify-between" style={{ flex: 3 }}>
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
        onClose={closeRegisterModal}
        onContinue={handleContinueRegister}
      />
    </LinearGradient>
  );
}
