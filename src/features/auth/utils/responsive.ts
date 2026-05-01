import {
  clamp,
  getPhoneSizeBucket,
  getTitleMetrics,
  scaleByBucket,
  type PhoneSizeBucket,
  type TitleMetrics,
} from '@/utils/responsive';

export interface AuthLandingMetrics extends TitleMetrics {
  screenWidth: number;
  screenHeight: number;
  isLandscape: boolean;
  phoneSize: PhoneSizeBucket;
  horizontalPadding: number;
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

export function getAuthLandingMetrics(width: number, height: number): AuthLandingMetrics {
  // Deriva metricas responsivas para la pantalla de auth.
  const isLandscape = width > height;
  const shortestSide = Math.min(width, height);
  const phoneSize = getPhoneSizeBucket(shortestSide);
  const compactFactor = isLandscape ? 0.86 : 1;
  const titleMetrics = getTitleMetrics(width, height);

  const horizontalPadding = scaleByBucket(phoneSize, [20, 24, 28, 32]);
  const socialLabel = scaleByBucket(phoneSize, [14, 15, 16, 16]);
  const socialIcon = scaleByBucket(phoneSize, [34, 37, 40, 42]);
  const buttonPadding = scaleByBucket(phoneSize, [13, 14, 15, 16]);
  const formFieldPadding = scaleByBucket(phoneSize, [11, 12, 13, 14]);

  return {
    screenWidth: width,
    screenHeight: height,
    isLandscape,
    phoneSize,
    ...titleMetrics,
    horizontalPadding,
    carouselHeight: clamp(scaleByBucket(phoneSize, [145, 165, 190, 210]) * compactFactor, 130, 220),
    carouselBaseImageSize: clamp(shortestSide * 0.5 * compactFactor, 115, 220),
    carouselTranslateFactor: shortestSide <= 350 ? 0.24 : 0.26,
    carouselSideScale: 0.7,
    carouselEdgeScale: 0.65,
    formHorizontalPadding: horizontalPadding + 8,
    formContainerRadius: 10,
    formFieldVerticalPadding: clamp(formFieldPadding * compactFactor, 10, 15),
    // Fix: min era mayor que el valor base, ahora el rango es correcto.
    formFieldHorizontalPadding: clamp(formFieldPadding * compactFactor, 8, 18),
    formFieldFontSize: scaleByBucket(phoneSize, [14, 15, 16, 16]),
    formFieldGap: clamp(10 * compactFactor, 8, 12),
    formFieldSeparatorWidth: clamp(width - horizontalPadding * 2 - 24, 180, 420),
    formErrorFontSize: clamp(socialLabel - 2, 12, 14),
    buttonVerticalPadding: clamp(buttonPadding * compactFactor, 12, 20),
    buttonFontSize: scaleByBucket(phoneSize, [17, 18, 19, 19]),
    buttonRadius: 24,
    buttonTopMargin: clamp(14 * compactFactor, 10, 16),
    sectionGap: clamp(12 * compactFactor, 8, 14),
    keyboardLiftDistance: clamp(shortestSide * 0.08, 24, 40),
    socialBottomMargin: clamp(60 * compactFactor, 46, 60),
    socialLabelFontSize: socialLabel,
    socialDividerWidth: clamp(width * 0.5, 150, 250),
    socialDividerBottomMargin: clamp(24 * compactFactor, 14, 24),
    socialIconsSize: socialIcon,
    socialIconsContainerSize: clamp(socialIcon + 12, 42, 54),
    socialIconsGap: scaleByBucket(phoneSize, [34, 40, 52, 64]),
  };
}
