import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { AuthLandingScreen, useAuth } from '../src/features/auth';
import { COLORS } from '../src/constants/theme';

export default function IndexScreen() {
  // Redirige segun el estado de autenticacion real.
  const { isAuthenticated, isLoading } = useAuth();

  // Mientras se restaura la sesion, muestra un spinner.
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: COLORS.bgDarkest }}>
        <ActivityIndicator size="small" color={COLORS.accentYellow} />
      </View>
    );
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <AuthLandingScreen />;
}
