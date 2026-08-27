import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { AuthLandingScreen, TrialExpiredScreen, useAuth } from '../src/features/auth';
import { COLORS } from '../src/constants/theme';
import { isStartHomeBypassEnabled } from '../src/navigation/start-home-bypass';
import { useIndexRoute } from './useIndexRoute';

export default function IndexScreen() {
  // Redirige segun el estado de autenticacion real y el gate de trial.
  const { isLoading, user, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const startHomeBypassEnabled = isStartHomeBypassEnabled();

  // Gate order (Slice 2): unauth -> AuthLanding; incomplete -> Onboarding even when locked;
  // complete+locked -> TrialExpired; complete+usable -> Tabs.
  //
  // The gate's `isComplete` input MUST come from the AuthContext (which
  // ORs the optimistic "I just submitted onboarding" flag with
  // me.onboarding.isComplete). The pre-fix code read isComplete
  // directly from me?.onboarding.isComplete, ignoring the optimistic
  // flag. During the optimistic window the two screens disagreed
  // about the route and the router ping-ponged
  // (/onboarding -> / -> /onboarding -> ...), which is the
  // "Maximum update depth exceeded" symptom. The hook memoizes the
  // resolved route string on the gate's primitive inputs so it does
  // not change between renders whose gate inputs are content-equal.
  //
  // Called unconditionally before any early return so React's rules
  // of hooks are satisfied.
  const route = useIndexRoute(startHomeBypassEnabled);

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  if (startHomeBypassEnabled) {
    return <Redirect href="/(tabs)/home" />;
  }

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

  if (route === 'Onboarding') {
    return <Redirect href="/onboarding" />;
  }

  if (route === 'TrialExpired') {
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
