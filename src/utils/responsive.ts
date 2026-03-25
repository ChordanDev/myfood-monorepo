export type PhoneSizeBucket = 'xs' | 'sm' | 'md' | 'lg';

export interface AuthLandingMetrics {
  screenWidth: number;
  screenHeight: number;
  isLandscape: boolean;
  phoneSize: PhoneSizeBucket;
  horizontalPadding: number;
  titleFontSize: number;
  titleBottomSpacing: number;
  carouselHeight: number;
  carouselBaseImageSize: number;
  carouselTranslateFactor: number;
  carouselSideScale: number;
  carouselEdgeScale: number;
  buttonVerticalPadding: number;
  buttonFontSize: number;
  buttonRadius: number;
  buttonsGap: number;
  sectionGap: number;
  socialTopPadding: number;
  socialBottomPadding: number;
  socialLabelFontSize: number;
  socialDividerWidth: number;
  socialDividerBottomMargin: number;
  socialIconsSize: number;
  socialIconsContainerSize: number;
  socialIconsGap: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getPhoneSizeBucket(shortestSide: number): PhoneSizeBucket {
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
    xs: 14,
    sm: 16,
    md: 18,
    lg: 20,
  };

  const buttonFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 16,
    sm: 17,
    md: 18,
    lg: 18,
  };

  const socialLabelBySize: Record<PhoneSizeBucket, number> = {
    xs: 14,
    sm: 15,
    md: 16,
    lg: 16,
  };

  const socialIconBySize: Record<PhoneSizeBucket, number> = {
    xs: 32,
    sm: 35,
    md: 38,
    lg: 40,
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
    carouselHeight: clamp(carouselHeightBySize[phoneSize] * compactFactor, 130, 220),
    carouselBaseImageSize: clamp(shortestSide * 0.5 * compactFactor, 115, 220),
    carouselTranslateFactor: shortestSide <= 350 ? 0.24 : 0.26,
    carouselSideScale: 0.7,
    carouselEdgeScale: 0.65,
    buttonVerticalPadding: clamp(buttonPaddingBySize[phoneSize] * compactFactor, 12, 20),
    buttonFontSize: buttonFontBySize[phoneSize],
    buttonRadius: 24,
    buttonsGap: clamp(20 * compactFactor, 14, 20),
    sectionGap: clamp(26 * compactFactor, 16, 28),
    socialTopPadding: clamp(64 * compactFactor, 40, 64),
    socialBottomPadding: clamp(40 * compactFactor, 26, 40),
    socialLabelFontSize: socialLabelBySize[phoneSize],
    socialDividerWidth: clamp(width * 0.5, 150, 250),
    socialDividerBottomMargin: clamp(24 * compactFactor, 14, 24),
    socialIconsSize: socialIconBySize[phoneSize],
    socialIconsContainerSize: clamp(socialIconBySize[phoneSize] + 12, 42, 54),
    socialIconsGap: socialGapBySize[phoneSize],
  };
}
