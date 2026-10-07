import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { getAuthLandingMetrics } from '../utils/responsive';

export function useAuthResponsiveScale() {
  const { width, height } = useWindowDimensions();

  // Memoiza metricas responsivas para evitar recalculos innecesarios.
  return useMemo(() => getAuthLandingMetrics(width, height), [width, height]);
}
