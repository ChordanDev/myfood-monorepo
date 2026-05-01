import { Redirect } from 'expo-router';
import { AuthLandingScreen } from '../src/features/auth';

export default function IndexScreen() {
  // Ruta inicial del flujo de autenticacion.
  // TODO: Reemplazar por estado de autenticacion real (ej: token en SecureStore)
  // cuando el backend de Elixir este integrado.
  const startHomeFlag = process.env.EXPO_PUBLIC_START_HOME === 'true';

  if (startHomeFlag) {
    return <Redirect href="/(tabs)/home" />;
  }

  return <AuthLandingScreen />;
}
