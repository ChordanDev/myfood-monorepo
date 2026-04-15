import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthResponsiveScale } from '../hooks';
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

import { Link } from 'expo-router';

export function AuthLandingScreen() {
  // Estado local para validacion y modal de registro.
  const metrics = useAuthResponsiveScale();
  const [isCredentialsValid, setIsCredentialsValid] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const { inputAnimatedStyle, isKeyboardOpen } = useKeyboardAnimation({
    enabled: !showRegisterModal,
  });

  const closeRegisterModal = () => {
    setShowRegisterModal(false);
  };

  const openRegisterModal = () => {
    setShowRegisterModal(true);
  };

  const handleContinueRegister = (_email: string) => {
    closeRegisterModal();
  };

  return (
    <LinearGradient
      colors={['#E5D8C4', '#242B12', '#191D0D', '#111309']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.65, 0.93, 0.98]}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />

      <SafeAreaContent>
        <View className="items-center" style={{ flex: 5, overflow: 'hidden' }}>
          <TopFadeMask enabled={isKeyboardOpen} fadeSize={50}>
            <View className="flex-1">
              <Animated.View className="h-full w-full justify-between" style={inputAnimatedStyle}>
                <View className="items-center">
                  {/* Encabezado visual con marca y carrusel. */}
                  <TitlePrimary text="MyFood" metrics={metrics} />
                  <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
                </View>

                <View>
                  {/* Formulario de login con validacion en vivo. */}
                  <AuthCredentialsForm
                    metrics={metrics}
                    onValidityChange={setIsCredentialsValid}
                    onCredentialsChange={({ email }) => setLoginEmail(email)}
                  />
                  {/* Navega a verificacion si el email es valido. */}
                  <Link
                    asChild
                    href={{
                      pathname: '/register',
                      params: { email: loginEmail, flow: 'login' },
                    }}>
                    <AuthButton
                      title="Iniciar Sesión"
                      variant="primary"
                      metrics={metrics}
                      disabled={!isCredentialsValid}
                    />
                  </Link>
                </View>
              </Animated.View>
            </View>
          </TopFadeMask>
        </View>

        <View className="justify-between" style={{ flex: 3 }}>
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
        onClose={closeRegisterModal}
        onContinue={handleContinueRegister}
      />
    </LinearGradient>
  );
}
