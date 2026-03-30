import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';
import { AUTH_FOOD_IMAGES } from '@/constants/authAssets';
import {
  AuthButton,
  AuthCredentialsForm,
  CarouselImages,
  SocialDivider,
  SocialLoginIcons,
} from '../components';
import TitlePrimaryComponent from '../../../components/TitlePrimary';

export function AuthLandingScreen() {
  const insets = useSafeAreaInsets(); // Para manejar los safe areas de la pantalla, el notch y la barra de abajo
  const metrics = useResponsiveScale(); // Para obtener las métricas responsivas
  const [isCredentialsValid, setIsCredentialsValid] = useState(false); // Para habilitar/deshabilitar el botón de iniciar sesión según la validez de las credenciales
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false); // Para saber si el teclado está abierto y ajustar el diseño en consecuencia
  const keyboardProgress = useRef(new Animated.Value(0)).current; // Para animar la transición de apertura/cierre del teclado y evitar cambios bruscos en el diseño

  // Efecto para escuchar los eventos de apertura y cierre del teclado, actualizar el estado y animar la transición
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    // Función para animar el valor de keyboardProgress entre 0 y 1, dependiendo de si el teclado se está mostrando o ocultando
    const animateTo = (toValue: number) => {
      Animated.timing(keyboardProgress, {
        toValue,
        duration: 220,
        useNativeDriver: true,
      }).start();
    };

    // Suscripciones a los eventos del teclado
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsKeyboardOpen(true);
      animateTo(1);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardOpen(false);
      animateTo(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardProgress]);

  // Interpolación del valor de opacidad para el BlurView, basado en el progreso del teclado, para crear un efecto de desenfoque gradual al abrir el teclado
  const blurOpacity = keyboardProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  // Interpolación del valor de translateY para la sección inferior, para que se desplace hacia arriba al abrir el teclado y evitar que quede cubierto por este
  const formShift = keyboardProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -metrics.keyboardLiftDistance],
  });

  return (
    <LinearGradient
      colors={['#E5D8C4', '#242B12', '#191D0D', '#111309']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.65, 0.93, 0.98]}
      className="flex-1"
      style={{ flex: 1 }}>
      <ImageBackground
        source={require('../../../../assets/noisy-background.jpg')}
        resizeMode={Platform.OS === 'ios' ? 'cover' : 'repeat'}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 0.2,
        }}
      />

      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <KeyboardAvoidingView
          className="items-center"
          style={{ flex: 4 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
          <Animated.View
            className="shrink justify-between"
            style={{
              paddingHorizontal: metrics.horizontalPadding,
              transform: [{ translateY: formShift }],
              flex: 1,
            }}>
            {/* Sección superior con título e imágenes */}
            <View className="items-center">
              {/* TÍTULO */}
              <TitlePrimaryComponent text="MyFood" metrics={metrics} />

              {/* CAROUSEL DE IMÁGENES */}
              <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
            </View>

            <AuthCredentialsForm metrics={metrics} onValidityChange={setIsCredentialsValid} />
          </Animated.View>
        </KeyboardAvoidingView>

        {/* Sección inferior con formulario, botones y opciones sociales */}

        <View
          className="justify-between"
          style={{
            flex: 3,
            paddingHorizontal: metrics.horizontalPadding,
            gap: metrics.sectionGap,
          }}>
          {/* BOTONES DE INICIAR SESIÓN Y REGISTRARSE */}
          <View className="justify-center" style={{ gap: metrics.buttonsGap, flex: 1 }}>
            <AuthButton
              title="Iniciar Sesión"
              variant="primary"
              metrics={metrics}
              disabled={!isCredentialsValid}
            />
            <AuthButton title="Registrarse" variant="secondary" metrics={metrics} />
          </View>

          {/* DIVISOR Y OPCIONES DE INICIO DE SESIÓN SOCIAL */}
          <View
            className="items-center justify-end"
            style={{
              paddingBottom: metrics.socialBottomPadding,
              flex: 1,
            }}>
            <SocialDivider metrics={metrics} />
            <SocialLoginIcons
              iconSize={metrics.socialIconsSize}
              containerSize={metrics.socialIconsContainerSize}
              gap={metrics.socialIconsGap}
            />
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}
