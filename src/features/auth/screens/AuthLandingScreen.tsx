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

      <View className="flex-1">
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            justifyContent: 'space-between',
          }}>
          
          {/* Sección superior con título e imágenes */}
          <View className="items-center" style={{ paddingHorizontal: metrics.horizontalPadding }}>
            
            {/* TÍTULO */}
            <View
              className="items-center justify-start pt-4"
              style={{
                marginBottom: metrics.titleBottomSpacing,
              }}>
              <Text
                style={{ fontSize: metrics.titleFontSize, color: '#242B12' }}
                className="font-montserrat-bold">
                MyFood
              </Text>
            </View>
            
            {/* CAROUSEL DE IMÁGENES */}
            <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
          </View>
          

          {/* Sección inferior con botones y opciones sociales */}
          <View
            className="shrink"
            style={{
              gap: metrics.sectionGap,
              paddingHorizontal: metrics.horizontalPadding,
            }}>

            {/* BOTONES DE INICIAR SESIÓN Y REGISTRARSE */}
            <View style={{ gap: metrics.buttonsGap }}>
              <AuthCredentialsForm metrics={metrics} onValidityChange={setIsCredentialsValid} />
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
              className="items-center"
              style={{
                paddingBottom: metrics.socialBottomPadding,
              }}>
              <SocialDivider metrics={metrics} />
              <SocialLoginIcons
                iconSize={metrics.socialIconsSize}
                containerSize={metrics.socialIconsContainerSize}
                gap={metrics.socialIconsGap}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </LinearGradient>
  );
}
