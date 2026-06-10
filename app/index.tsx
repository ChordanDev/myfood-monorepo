import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { AuthLandingScreen, TrialExpiredScreen, useAuth } from '../src/features/auth';
import { COLORS } from '../src/constants/theme';
import { resolveIndexGate } from './indexGate';

export default function IndexScreen() {
  // Redirige segun el estado de autenticacion real y el gate de trial.
  const { isAuthenticated, isLoading, canUseApp, isTrialExpired, me, user, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  // Mientras se restaura la sesion, muestra un spinner.
  if (isLoading) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: COLORS.bgDarkest }}>
        <ActivityIndicator size="small" color={COLORS.accentYellow} />
      </View>
    );
  }

  // Gate order (Slice 2): unauth -> AuthLanding; incomplete -> Onboarding even when locked;
  // complete+locked -> TrialExpired; complete+usable -> Tabs.
  const route = resolveIndexGate({
    isAuthenticated,
    isComplete: me?.onboarding.isComplete ?? false,
    canUseApp,
  });

  if (route === 'Onboarding') {
    return <Redirect href="/onboarding" />;
  }

  if (route === 'TrialExpired' || isTrialExpired) {
    return (
      <TrialExpiredScreen
        email={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={handleSignOut}
      />
    );
  }

  if (route === 'Tabs') {
    return <Redirect href="/(tabs)/home" />;
  }

  return <AuthLandingScreen />;
}
