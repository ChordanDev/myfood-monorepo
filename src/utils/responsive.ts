export type PhoneSizeBucket = 'xs' | 'sm' | 'md' | 'lg';

export interface AuthLandingMetrics {
  screenWidth: number;
  screenHeight: number;
  isLandscape: boolean;
  phoneSize: PhoneSizeBucket;
  horizontalPadding: number;
  titleFontSize: number;
  titleBottomSpacing: number;
  titleTopSpacing: number;
  carouselHeight: number;
  carouselBaseImageSize: number;
  carouselTranslateFactor: number;
  carouselSideScale: number;
  carouselEdgeScale: number;
  formHorizontalPadding: number;
  formContainerRadius: number;
  formFieldVerticalPadding: number;
  formFieldHorizontalPadding: number;
  formFieldFontSize: number;
  formFieldGap: number;
  formFieldSeparatorWidth: number;
  formErrorFontSize: number;
  buttonVerticalPadding: number;
  buttonFontSize: number;
  buttonRadius: number;
  buttonTopMargin: number;
  sectionGap: number;
  keyboardLiftDistance: number;
  socialBottomMargin: number;
  socialLabelFontSize: number;
  socialDividerWidth: number;
  socialDividerBottomMargin: number;
  socialIconsSize: number;
  socialIconsContainerSize: number;
  socialIconsGap: number;
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

export function getAuthLandingMetrics(width: number, height: number): AuthLandingMetrics {
  // Deriva metricas responsivas para la pantalla de auth.
  const isLandscape = width > height;
  const shortestSide = Math.min(width, height);
  const phoneSize = getPhoneSizeBucket(shortestSide);

  const compactFactor = isLandscape ? 0.86 : 1;

  const horizontalPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 20,
    sm: 24,
    md: 28,
    lg: 32,
  };

  const titleFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 38,
    sm: 42,
    md: 46,
    lg: 48,
  };

  const carouselHeightBySize: Record<PhoneSizeBucket, number> = {
    xs: 145,
    sm: 165,
    md: 190,
    lg: 210,
  };

  const buttonPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 13,
    sm: 14,
    md: 15,
    lg: 16,
  };

  const formFieldPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 11,
    sm: 12,
    md: 13,
    lg: 14,
  };

  const formFieldFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 14,
    sm: 15,
    md: 16,
    lg: 16,
  };

  const buttonFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 17,
    sm: 18,
    md: 19,
    lg: 19,
  };

  const socialLabelBySize: Record<PhoneSizeBucket, number> = {
    xs: 14,
    sm: 15,
    md: 16,
    lg: 16,
  };

  const socialIconBySize: Record<PhoneSizeBucket, number> = {
    xs: 34,
    sm: 37,
    md: 40,
    lg: 42,
  };

  const socialGapBySize: Record<PhoneSizeBucket, number> = {
    xs: 34,
    sm: 40,
    md: 52,
    lg: 64,
  };

  return {
    screenWidth: width,
    screenHeight: height,
    isLandscape,
    phoneSize,
    horizontalPadding: horizontalPaddingBySize[phoneSize],
    titleFontSize: titleFontBySize[phoneSize],
    titleBottomSpacing: clamp(40 * compactFactor, 28, 40),
    titleTopSpacing: clamp(10 * compactFactor, 6, 14),
    carouselHeight: clamp(carouselHeightBySize[phoneSize] * compactFactor, 130, 220),
    carouselBaseImageSize: clamp(shortestSide * 0.5 * compactFactor, 115, 220),
    carouselTranslateFactor: shortestSide <= 350 ? 0.24 : 0.26,
    carouselSideScale: 0.7,
    carouselEdgeScale: 0.65,
    formHorizontalPadding: horizontalPaddingBySize[phoneSize] + 8,
    formContainerRadius: 10,
    formFieldVerticalPadding: clamp(formFieldPaddingBySize[phoneSize] * compactFactor, 10, 15),
    formFieldHorizontalPadding: clamp(10 * compactFactor, 12, 18),
    formFieldFontSize: formFieldFontBySize[phoneSize],
    formFieldGap: clamp(10 * compactFactor, 8, 12),
    formFieldSeparatorWidth: clamp(width - horizontalPaddingBySize[phoneSize] * 2 - 24, 180, 420),
    formErrorFontSize: clamp(socialLabelBySize[phoneSize] - 2, 12, 14),
    buttonVerticalPadding: clamp(buttonPaddingBySize[phoneSize] * compactFactor, 12, 20),
    buttonFontSize: buttonFontBySize[phoneSize],
    buttonRadius: 24,
    buttonTopMargin: clamp(14 * compactFactor, 10, 16),
    sectionGap: clamp(12 * compactFactor, 8, 14),
    keyboardLiftDistance: clamp(shortestSide * 0.08, 24, 40),
    socialBottomMargin: clamp(60 * compactFactor, 46, 60),
    socialLabelFontSize: socialLabelBySize[phoneSize],
    socialDividerWidth: clamp(width * 0.5, 150, 250),
    socialDividerBottomMargin: clamp(24 * compactFactor, 14, 24),
    socialIconsSize: socialIconBySize[phoneSize],
    socialIconsContainerSize: clamp(socialIconBySize[phoneSize] + 12, 42, 54),
    socialIconsGap: socialGapBySize[phoneSize],
  };
}
