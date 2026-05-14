import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  withTiming,
  useSharedValue,
  Easing,
  withSequence,
} from 'react-native-reanimated';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { COLORS } from '../../src/constants/theme';
import { useAuth } from '../../src/features/auth';

const AnimatedTabButton = ({ route, isFocused, onPress, options }: any) => {
  const width = useSharedValue(isFocused ? 60 : 40);
  const opacity = useSharedValue(isFocused ? 1 : 0);
  const iconScale = useSharedValue(1);

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
  }, [isFocused, width, opacity, iconScale]);

  const animatedOvalStyle = useAnimatedStyle(() => {
    return {
      width: width.value,
      opacity: opacity.value,
    };
  });

  const animatedIconStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: iconScale.value }],
    };
  });

  return (
    <Pressable onPress={onPress} style={styles.tabButton}>
      <Animated.View style={[styles.indicatorOval, animatedOvalStyle]} />
      <Animated.View style={animatedIconStyle}>
        {options.tabBarIcon &&
          options.tabBarIcon({
            focused: isFocused,
            color: isFocused ? COLORS.accentYellow : COLORS.accentGreenMuted,
            size: 24,
          })}
      </Animated.View>
    </Pressable>
  );
};

function CustomTabBar({
  state,
  descriptors,
  navigation,
  insets,
}: BottomTabBarProps & { insets: any }) {
  return (
    <View style={[styles.tabBarContainer, { height: insets.bottom + 60 }]}>
      <LinearGradient
        colors={['#15180F', '#0D1007']}
        locations={[0.61, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.tabsRow}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

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
              route={route}
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
  const { isAuthenticated, isLoading } = useAuth();

  // Muestra nada mientras se verifica la sesion inicial para evitar redirect falso
  if (isLoading) {
    return null;
  }

  // Protege las tabs contra acceso directo sin autenticacion.
  if (!isAuthenticated) {
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
    </Tabs >
  );
}

const styles = StyleSheet.create({
  tabBarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 0,
    borderTopWidth: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    height: 60,
    alignItems: 'center',
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  indicatorOval: {
    position: 'absolute',
    height: 40,
    backgroundColor: 'rgba(216, 217, 139, 0.15)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(216, 217, 139, 0.3)',
  },
});
