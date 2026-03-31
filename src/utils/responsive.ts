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
  socialBottomPadding: number;
  socialLabelFontSize: number;
  socialDividerWidth: number;
  socialDividerBottomMargin: number;
  socialIconsSize: number;
  socialIconsContainerSize: number;
  socialIconsGap: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value)); // Asegura que el valor esté entre min y max
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
    // Métricas generales
    screenWidth: width, // Ancho de la pantalla
    screenHeight: height, // Alto de la pantalla
    isLandscape, // Indica si el dispositivo está en orientación horizontal
    phoneSize, // Bucket de tamaño del teléfono
    horizontalPadding: horizontalPaddingBySize[phoneSize], // Padding horizontal basado en el tamaño del teléfono

    // Métricas del título
    titleFontSize: titleFontBySize[phoneSize], // Tamaño de fuente del título basado en el tamaño del teléfono
    titleBottomSpacing: clamp(40 * compactFactor, 28, 40), // Espacio inferior del título, ajustado por el factor de compacidad y limitado entre 28 y 40
    titleTopSpacing: clamp(10 * compactFactor, 6, 14), // Margen superior del título, ajustado por el factor de compacidad y limitado entre 2 y 10

    // Métricas del carrusel
    carouselHeight: clamp(carouselHeightBySize[phoneSize] * compactFactor, 130, 220), // Altura del carrusel, ajustada por el factor de compacidad y limitada entre 130 y 220
    carouselBaseImageSize: clamp(shortestSide * 0.5 * compactFactor, 115, 220), // Tamaño base de las imágenes del carrusel, basado en la mitad del lado más corto, ajustado por el factor de compacidad y limitado entre 115 y 220
    carouselTranslateFactor: shortestSide <= 350 ? 0.24 : 0.26, // Factor de traducción del carrusel, ajustado para teléfonos muy pequeños
    carouselSideScale: 0.7, // Escala de las imágenes laterales del carrusel
    carouselEdgeScale: 0.65, // Escala de las imágenes en los bordes del carrusel

    // Métricas del formulario
    formHorizontalPadding: horizontalPaddingBySize[phoneSize] + 8, // Padding horizontal del formulario, basado en el tamaño del teléfono
    formContainerRadius: 10, // Radio del contenedor del formulario
    formFieldVerticalPadding: clamp(formFieldPaddingBySize[phoneSize] * compactFactor, 10, 15), // Padding vertical de los campos del formulario, ajustado por el factor de compacidad y limitado entre 10 y 15
    formFieldHorizontalPadding: clamp(10 * compactFactor, 12, 18), // Padding horizontal de los campos del formulario, ajustado por el factor de compacidad y limitado entre 12 y 18
    formFieldFontSize: formFieldFontBySize[phoneSize], // Tamaño de fuente de los campos del formulario, basado en el tamaño del teléfono
    formFieldGap: clamp(10 * compactFactor, 8, 12), // Gap entre los campos del formulario, ajustado por el factor de compacidad y limitado entre 8 y 12
    formFieldSeparatorWidth: clamp(width - horizontalPaddingBySize[phoneSize] * 2 - 24, 180, 420), // Ancho del separador de campos del formulario, basado en el ancho de la pantalla menos los paddings horizontales y un margen adicional, limitado entre 180 y 420
    formErrorFontSize: clamp(socialLabelBySize[phoneSize] - 2, 12, 14), // Tamaño de fuente de los mensajes de error del formulario, basado en el tamaño de las etiquetas sociales menos un ajuste, limitado entre 12 y 14

    // Métricas de los botones
    buttonVerticalPadding: clamp(buttonPaddingBySize[phoneSize] * compactFactor, 12, 20), // Padding vertical de los botones, ajustado por el factor de compacidad y limitado entre 12 y 20
    buttonFontSize: buttonFontBySize[phoneSize], // Tamaño de fuente de los botones, basado en el tamaño del teléfono
    buttonRadius: 24, // Radio de los botones
    buttonTopMargin: clamp(14 * compactFactor, 10, 16), // Margen superior de los botones, ajustado por el factor de compacidad y limitado entre 14 y 24

    // Gap entre botones de autenticación y opciones sociales
    sectionGap: clamp(12 * compactFactor, 8, 14),
    keyboardLiftDistance: clamp(shortestSide * 0.08, 24, 40),

    // Métricas de los elementos sociales
    socialBottomPadding: clamp(40 * compactFactor, 26, 40), // Padding inferior de los elementos sociales, ajustado por el factor de compacidad y limitado entre 26 y 40
    socialLabelFontSize: socialLabelBySize[phoneSize], // Tamaño de fuente de las etiquetas sociales, basado en el tamaño del teléfono
    socialDividerWidth: clamp(width * 0.5, 150, 250), // Ancho del divisor social, basado en la mitad del ancho de la pantalla y limitado entre 150 y 250
    socialDividerBottomMargin: clamp(24 * compactFactor, 14, 24), // Margen inferior del divisor social, ajustado por el factor de compacidad y limitado entre 14 y 24
    socialIconsSize: socialIconBySize[phoneSize], // Tamaño de los íconos sociales, basado en el tamaño del teléfono
    socialIconsContainerSize: clamp(socialIconBySize[phoneSize] + 12, 42, 54), // Tamaño del contenedor de los íconos sociales, basado en el tamaño de los íconos más un padding adicional, limitado entre 42 y 54
    socialIconsGap: socialGapBySize[phoneSize], // Gap entre los íconos sociales, basado en el tamaño del teléfono
  };
}
