export type PhoneSizeBucket = 'xs' | 'sm' | 'md' | 'lg';

export interface TitleMetrics {
  titleFontSize: number;
  titleBottomSpacing: number;
  titleTopSpacing: number;
}

export function clamp(value: number, min: number, max: number): number {
  // Limita un valor dentro de un rango.
  return Math.min(max, Math.max(min, value));
}

/**
 * Helper generico para obtener un valor numerico segun el bucket de tamaño.
 * Reduce el boilerplate de definir un Record<PhoneSizeBucket, number> por cada metrica.
 *
 * @param size - Bucket del dispositivo actual.
 * @param values - Tupla [xs, sm, md, lg].
 */
export function scaleByBucket(
  size: PhoneSizeBucket,
  values: [number, number, number, number]
): number {
  const map: Record<PhoneSizeBucket, number> = {
    xs: values[0],
    sm: values[1],
    md: values[2],
    lg: values[3],
  };
  return map[size];
}

export function getPhoneSizeBucket(shortestSide: number): PhoneSizeBucket {
  // Clasifica el dispositivo segun su lado mas corto.
  if (shortestSide <= 350) {
    return 'xs';
  }

  if (shortestSide <= 390) {
    return 'sm';
  }

  if (shortestSide <= 430) {
    return 'md';
  }

  return 'lg';
}

export function getTitleMetrics(width: number, height: number): TitleMetrics {
  // Deriva metricas base para titulos.
  const isLandscape = width > height;
  const shortestSide = Math.min(width, height);
  const phoneSize = getPhoneSizeBucket(shortestSide);

  const compactFactor = isLandscape ? 0.86 : 1;

  return {
    titleFontSize: scaleByBucket(phoneSize, [38, 42, 46, 48]),
    titleBottomSpacing: clamp(24 * compactFactor, 12, 24),
    titleTopSpacing: clamp(10 * compactFactor, 6, 14),
  };
}
