import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  Easing,
  withSequence,
} from 'react-native-reanimated';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useAuth } from '../../src/features/auth';
import { useRecipeTheme } from '../../src/context/RecipeThemeContext';
import { useThemeColor } from '../../src/hooks/useThemeColor';
import { useGradientCrossfade } from '../../src/hooks/useGradientCrossfade';
import { useAnimatedThemeStyle } from '../../src/hooks/useAnimatedThemeStyle';
import { resolveTabsGate } from '../../src/navigation/start-home-bypass';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '../../src/features/planner/constants';

// Componente que anima cada botón de tab al ser seleccionado.
const AnimatedTabButton = ({ isFocused, onPress, options }: any) => {
  const width = useSharedValue(isFocused ? 60 : 40);
  const opacity = useSharedValue(isFocused ? 1 : 0);
  const iconScale = useSharedValue(1);
  const { getColorWithOpacity, theme } = useThemeColor();
  const ovalThemeStyle = useAnimatedThemeStyle({
    backgroundColor: getColorWithOpacity('icon', 0.15),
    borderColor: getColorWithOpacity('icon', 0.3),
  });

  useEffect(() => {
    if (isFocused) {
      // Óvalo: Aparece suavemente de círculo (40) a píldora (60)
      opacity.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.quad) });
      width.value = withTiming(60, { duration: 300, easing: Easing.out(Easing.quad) });

      // Icono: Pequeño pop bounce para dar feedback
      iconScale.value = 0.8;
      iconScale.value = withSequence(
        withTiming(1.1, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) })
      );
    } else {
      // Desaparece y vuelve a forma circular
      opacity.value = withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) });
      width.value = withTiming(40, { duration: 250, easing: Easing.in(Easing.quad) });
      iconScale.value = withTiming(1, { duration: 200 });
    }
  }, [iconScale, isFocused, opacity, width]);

  // Estilos animados para el óvalo indicador y el icono.
  const animatedOvalStyle = useAnimatedStyle(() => {
    return {
      width: width.value,
      opacity: opacity.value,
    };
  });

  // El icono hace un pequeño pop al seleccionar la tab para dar feedback visual.
  const animatedIconStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: iconScale.value }],
    };
  });

  return (
    <Pressable onPress={onPress} className="h-full flex-1 items-center justify-center">
      <Animated.View
        className="absolute h-10 rounded-[20px] border"
        style={[animatedOvalStyle, ovalThemeStyle]}
      />
      <Animated.View style={animatedIconStyle}>
        {/* Icono de la tab que fue previamente definido en TabsLayout */}
        {options.tabBarIcon &&
          options.tabBarIcon({
            focused: isFocused,
            color: isFocused ? theme.icon : getColorWithOpacity('icon', 0.8),
            size: 24,
          })}
      </Animated.View>
    </Pressable>
  );
};

// Componente personalizado para la tab bar que incluye el fondo con gradiente y los botones animados.
function CustomTabBar({
  state, // Estado de navegación que incluye las rutas y la ruta activa
  descriptors, // Descriptores de cada ruta que incluyen opciones como el icono
  navigation, // Objeto de navegación para manejar la navegación entre tabs
  insets,
}: BottomTabBarProps & { insets: any }) {
  const { theme } = useRecipeTheme();
  const tabBarBackgroundColors: [string, string] = [theme.colorDark, theme.colorBlack];
  const {
    currentColors: currentTabBarBackgroundColors,
    previousColors: previousTabBarBackgroundColors,
    animatedStyle: animatedTabBarBackgroundStyle,
    AnimatedView,
  } = useGradientCrossfade(tabBarBackgroundColors);

  return (
    <View
      className="absolute bottom-0 left-0 right-0 border-t-0"
      style={{
        height: insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT,
        elevation: 0,
      }}>
      <LinearGradient
        colors={previousTabBarBackgroundColors}
        locations={[0.61, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <AnimatedView style={[StyleSheet.absoluteFillObject, animatedTabBarBackgroundStyle]}>
        <LinearGradient
          colors={currentTabBarBackgroundColors}
          locations={[0.61, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ flex: 1 }}
        />
      </AnimatedView>
      <View className="h-[60px] flex-row items-center">
        {/* Mapeo de rutas a botones de tab */}
        {state.routes
          .filter((route) => route.name !== 'planner')
          .map((route) => {
            const { options } = descriptors[route.key];
            const isFocused = state.routes[state.index].key === route.key;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            return (
              <AnimatedTabButton
                key={route.key}
                isFocused={isFocused}
                onPress={onPress}
                options={options}
              />
            );
          })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, isLoading, canUseApp, isComplete } = useAuth();
  const gate = resolveTabsGate({ isAuthenticated, isLoading, canUseApp, isComplete });

  // Muestra nada mientras se verifica la sesion inicial para evitar redirect falso
  if (gate === 'Loading') {
    return null;
  }

  // Defense in depth (Judgment Day S1): incomplete users must never reach
  // tabs, even via deep links. The index gate at `app/index.tsx` already
  // routes them to `/onboarding`, but a direct deep link to a tab route
  // (e.g. from a push notification) would otherwise land here. The
  // individual screens also redirect as a second layer, but enforcing
  // it at the layout keeps the invariant obvious.
  if (gate === 'RedirectToIndex') {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} insets={insets} />}
      screenOptions={{
        headerShown: false,
      }}>
      <Tabs.Screen
        name="home"
        // options es guardado en el descriptor de cada ruta el cual es pasado al CustomTabBar para que lo renderize a su manera.
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Carrito',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'cart' : 'cart-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'Lista',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="planner" options={{ href: null }} />
    </Tabs>
  );
}
