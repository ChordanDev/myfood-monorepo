import { useState } from 'react';
import { Animated, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';
import { useKeyboardAnimation } from '@/hooks/useKeyboardAnimation';
import { AUTH_FOOD_IMAGES } from '@/constants/authAssets';
import { AuthButton, AuthCredentialsForm, CarouselImages, SocialLogin } from '../components';
import { NoisyBackground, SafeAreaContent, TitlePrimary, TopFadeMask } from '../../../components';

export function AuthLandingScreen() {
  const metrics = useResponsiveScale();
  const [isCredentialsValid, setIsCredentialsValid] = useState(false);
  const { formShift, isKeyboardOpen } = useKeyboardAnimation();

  const animatedAuthContent = (
    <View className="flex-1 justify-between">
      <Animated.View
        className="w-full shrink justify-between"
        style={{
          transform: [{ translateY: formShift }],
          flex: 1,
        }}>
        <View className="items-center">
          {/* TÍTULO */}
          <TitlePrimary text="MyFood" metrics={metrics} />

          {/* CAROUSEL DE IMÁGENES */}
          <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
        </View>

        <View>
          {/* FORMULARIO DE CREDENCIALES */}
          <AuthCredentialsForm metrics={metrics} onValidityChange={setIsCredentialsValid} />
          <AuthButton
            title="Iniciar Sesión"
            variant="primary"
            metrics={metrics}
            disabled={!isCredentialsValid}
          />
        </View>
      </Animated.View>
    </View>
  );

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
        <View className="items-center" style={{ flex: 2, overflow: 'hidden' }}>
          <TopFadeMask enabled={isKeyboardOpen} fadeSize={50}>
            {animatedAuthContent}
          </TopFadeMask>
        </View>

        {/* Sección botones y opciones sociales */}
        <View className="justify-between" style={{ flex: 1 }}>
          <AuthButton title="Registrarse" variant="secondary" metrics={metrics} />

          <SocialLogin metrics={metrics} />
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
