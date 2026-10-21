import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { useRevenueCatSession } from '../src/features/billing';
import { useClearFavoritesOnSignOut } from '../src/features/favorites';
import { RecipeThemeProvider } from '../src/context/RecipeThemeContext';

// Lives under the AuthProvider, which it reads; it draws nothing.
function FavoritesSession() {
  useClearFavoritesOnSignOut();

  return null;
}

// Keeps RevenueCat logged in with the signed-in Account; under the AuthProvider, draws nothing.
function RevenueCatSession() {
  useRevenueCatSession();

  return null;
}

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
      <View style={[styles.centeredScreen, { backgroundColor: COLORS.bgDarkest }]}>
        <ActivityIndicator size="small" color={COLORS.accentYellow} />
      </View>
    );
  }

  // Muestra un error visible si las fuentes no pudieron cargarse.
  if (fontError) {
    return (
      <View style={[styles.errorScreen, { backgroundColor: COLORS.bgDarkest }]}>
        <Text style={[styles.errorTitle, { color: COLORS.accentOrange }]}>
          Error cargando fuentes
        </Text>
        <Text style={[styles.errorMessage, { color: COLORS.textLight }]}>{fontError.message}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <FavoritesSession />
          <RevenueCatSession />
          <RecipeThemeProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </RecipeThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  centeredScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  errorScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 21,
  },
  errorTitle: {
    fontSize: 15.75,
    fontWeight: '700',
    lineHeight: 24.5,
  },
  errorMessage: {
    fontSize: 12.25,
    lineHeight: 17.5,
    marginTop: 7,
    textAlign: 'center',
  },
});
