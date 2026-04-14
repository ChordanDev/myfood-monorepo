import { Redirect } from 'expo-router';
import { AuthLandingScreen } from '../src/features/auth';

export default function IndexScreen() {
  // Ruta inicial del flujo de autenticacion.
  const startHomeFlag = process.env.EXPO_PUBLIC_START_HOME === 'true';

  if (startHomeFlag) {
    return <Redirect href="/home" />;
  }

  return <AuthLandingScreen />;
}
