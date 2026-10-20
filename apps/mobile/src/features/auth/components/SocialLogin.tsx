import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AuthLandingMetrics } from '@/features/auth/utils/responsive';
import { isSocialProviderAvailable } from '../services/socialSignIn';
import type { SocialProvider } from '../types/auth';
import { SocialDivider } from './SocialDivider';
import { SocialLoginIcons } from './SocialLoginIcons';

// Display order of the buttons.
const PROVIDERS: SocialProvider[] = ['google', 'apple'];

interface SocialLoginProps {
  metrics: AuthLandingMetrics;
  onPress: (provider: SocialProvider) => void;
  disabled?: boolean;
}

export function SocialLogin({ metrics, onPress, disabled = false }: SocialLoginProps) {
  const [available, setAvailable] = useState<SocialProvider[]>([]);

  // Availability is per device (Apple Sign In needs iOS), and Apple's answer is async.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      PROVIDERS.map((provider) => isSocialProviderAvailable(provider).catch(() => false))
    ).then((flags) => {
      if (!cancelled) setAvailable(PROVIDERS.filter((_, index) => flags[index]));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (available.length === 0) return null;

  return (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: metrics.horizontalPadding,
        marginBottom: metrics.socialBottomMargin,
      }}>
      {/* Separador y botones de login social. */}
      <SocialDivider metrics={metrics} />
      <SocialLoginIcons
        providers={available}
        onPress={onPress}
        disabled={disabled}
        iconSize={metrics.socialIconsSize}
        containerSize={metrics.socialIconsContainerSize}
        gap={metrics.socialIconsGap}
      />
    </View>
  );
}
