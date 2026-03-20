import '../global.css';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { 
  Montserrat_400Regular, 
  Montserrat_600SemiBold, 
  Montserrat_700Bold, 
  Montserrat_800ExtraBold 
} from "@expo-google-fonts/montserrat";
import {
Inter_400Regular,
Inter_500Medium,
Inter_600SemiBold,
Inter_700Bold
} from "@expo-google-fonts/inter";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold
  });
if (!fontsLoaded) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
