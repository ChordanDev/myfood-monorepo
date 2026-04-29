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

  const titleFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 38,
    sm: 42,
    md: 46,
    lg: 48,
  };

  return {
    titleFontSize: titleFontBySize[phoneSize],
    titleBottomSpacing: clamp(24 * compactFactor, 12, 24),
    titleTopSpacing: clamp(10 * compactFactor, 6, 14),
  };
}
