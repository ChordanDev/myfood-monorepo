import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { getAuthLandingMetrics } from '@/utils/responsive';

export function useResponsiveScale() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => getAuthLandingMetrics(width, height), [width, height]);
}
