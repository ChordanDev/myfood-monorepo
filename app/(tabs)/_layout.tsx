import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../src/constants/theme';
import { useAuth } from '../../src/features/auth';

const TAB_GRADIENT_LOCATIONS = Platform.select({
  ios: [0, 0.5, 0.7, 1] as const,
  android: [0, 0.65, 0.85, 1] as const,
}) || [0, 0, 1, 1];

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
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: COLORS.accentYellow,
        tabBarInactiveTintColor: COLORS.accentGreenMuted,
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: insets.bottom + 50,
        },
        tabBarBackground: () => (
          <LinearGradient
            colors={['#3d4436ff', '#22261E', '#121410ff', '#000000ff']}
            locations={TAB_GRADIENT_LOCATIONS}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={{ flex: 1 }}
          />
        ),
        tabBarItemStyle: {
          paddingTop: 6,
          paddingBottom: 6,
        },
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Carrito',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: 'Lista',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs >
  );
}
