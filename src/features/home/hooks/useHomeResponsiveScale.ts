import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { getHomeMetrics } from '../utils/responsive';

export function useHomeResponsiveScale() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => getHomeMetrics(width, height), [width, height]);
}
