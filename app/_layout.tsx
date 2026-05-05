// Carga global de estilos para NativeWind.
import '../global.css';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Montserrat_400Regular,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import {
  MontserratAlternates_700Bold,
  MontserratAlternates_900Black,
} from '@expo-google-fonts/montserrat-alternates';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { COLORS } from '../src/constants/theme';
import { AuthProvider } from '../src/features/auth';

export default function RootLayout() {
  // Carga fuentes antes de renderizar la navegacion.
  const [fontsLoaded, fontError] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    MontserratAlternates_700Bold,
    MontserratAlternates_900Black,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Evita una pantalla en blanco mientras cargan las fuentes.
  if (!fontsLoaded && !fontError) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: COLORS.bgDarkest }}>
        <ActivityIndicator size="small" color={COLORS.accentYellow} />
      </View>
    );
  }

  // Muestra un error visible si las fuentes no pudieron cargarse.
  if (fontError) {
    return (
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: COLORS.bgDarkest }}>
        <Text className="font-bold text-lg" style={{ color: COLORS.accentOrange }}>
          Error cargando fuentes
        </Text>
        <Text className="mt-2 text-center text-sm" style={{ color: COLORS.textLight }}>
          {fontError.message}
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
