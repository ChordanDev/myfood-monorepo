import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { getTitleMetrics } from '@/utils/responsive';

export function useTitleMetrics() {
  const { width, height } = useWindowDimensions();

  // Memoiza metricas base para titulos.
  return useMemo(() => getTitleMetrics(width, height), [width, height]);
}
