import {
  clamp,
  getPhoneSizeBucket,
  getTitleMetrics,
  type PhoneSizeBucket,
  type TitleMetrics,
} from '@/utils/responsive';

export interface HomeMetrics extends TitleMetrics {
  screenWidth: number;
  screenHeight: number;
  isLandscape: boolean;
  phoneSize: PhoneSizeBucket;
  horizontalPadding: number;
  bottomPadding: number;
  sectionGap: number;
  rowGap: number;
  cardColumnPercent: number;
  sideColumnPercent: number;
  addButtonSize: number;
  foodImageLeftPercent: number;
  foodImageTopPercent: number;
  foodImageWidthPercent: number;
  foodImageSizeScale: number;
  foodCardLabelFontSize: number;
  foodCardNumberFontSize: number;
  foodCardDescriptionFontSize: number;
  foodCardDescriptionLineHeight: number;
  switcherPadding: number;
  switcherRadius: number;
  switcherItemPaddingVertical: number;
  switcherFontSize: number;
  calendarDaySize: number;
  calendarHeaderFontSize: number;
  calendarNavFontSize: number;
  calendarWeekdayFontSize: number;
  calendarDayFontSize: number;
}

export function getHomeMetrics(width: number, height: number): HomeMetrics {
  const isLandscape = width > height;
  const shortestSide = Math.min(width, height);
  const phoneSize = getPhoneSizeBucket(shortestSide);
  const compactFactor = isLandscape ? 0.9 : 1;
  const titleMetrics = getTitleMetrics(width, height);

  const horizontalPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
  };

  const bottomPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
  };

  const sectionGapBySize: Record<PhoneSizeBucket, number> = {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
  };

  const rowGapBySize: Record<PhoneSizeBucket, number> = {
    xs: 10,
    sm: 12,
    md: 14,
    lg: 16,
  };

  const cardColumnBySize: Record<PhoneSizeBucket, number> = {
    xs: 70,
    sm: 72,
    md: 75,
    lg: 76,
  };

  const addButtonBySize: Record<PhoneSizeBucket, number> = {
    xs: 64,
    sm: 65,
    md: 68,
    lg: 70,
  };

  const foodImageLeftBySize: Record<PhoneSizeBucket, number> = {
    xs: 74,
    sm: 76,
    md: 78,
    lg: 80,
  };

  const foodImageTopBySize: Record<PhoneSizeBucket, number> = {
    xs: 30,
    sm: 30,
    md: 30,
    lg: 30,
  };

  const foodImageWidthBySize: Record<PhoneSizeBucket, number> = {
    xs: 38,
    sm: 40,
    md: 40,
    lg: 42,
  };

  const foodImageScaleBySize: Record<PhoneSizeBucket, number> = {
    xs: 1.75,
    sm: 1.7,
    md: 1.65,
    lg: 1.6,
  };

  const foodCardLabelBySize: Record<PhoneSizeBucket, number> = {
    xs: 16,
    sm: 17,
    md: 18,
    lg: 19,
  };

  const foodCardNumberBySize: Record<PhoneSizeBucket, number> = {
    xs: 18,
    sm: 19,
    md: 20,
    lg: 21,
  };

  const foodCardDescriptionBySize: Record<PhoneSizeBucket, number> = {
    xs: 13,
    sm: 14,
    md: 15,
    lg: 16,
  };

  const switcherFontBySize: Record<PhoneSizeBucket, number> = {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 15,
  };

  const switcherPaddingBySize: Record<PhoneSizeBucket, number> = {
    xs: 6,
    sm: 7,
    md: 8,
    lg: 9,
  };

  const calendarHeaderBySize: Record<PhoneSizeBucket, number> = {
    xs: 17,
    sm: 18,
    md: 19,
    lg: 20,
  };

  const calendarNavBySize: Record<PhoneSizeBucket, number> = {
    xs: 18,
    sm: 19,
    md: 20,
    lg: 20,
  };

  const calendarWeekdayBySize: Record<PhoneSizeBucket, number> = {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 14,
  };

  const calendarDayBySize: Record<PhoneSizeBucket, number> = {
    xs: 13,
    sm: 14,
    md: 15,
    lg: 16,
  };

  const foodCardDescriptionFontSize = foodCardDescriptionBySize[phoneSize];

  return {
    screenWidth: width,
    screenHeight: height,
    isLandscape,
    phoneSize,
    ...titleMetrics,
    horizontalPadding: horizontalPaddingBySize[phoneSize],
    bottomPadding: bottomPaddingBySize[phoneSize],
    sectionGap: sectionGapBySize[phoneSize],
    rowGap: rowGapBySize[phoneSize],
    cardColumnPercent: cardColumnBySize[phoneSize],
    sideColumnPercent: 100 - cardColumnBySize[phoneSize],
    addButtonSize: clamp(addButtonBySize[phoneSize] * compactFactor, 50, 72),
    foodImageLeftPercent: foodImageLeftBySize[phoneSize],
    foodImageTopPercent: foodImageTopBySize[phoneSize],
    foodImageWidthPercent: foodImageWidthBySize[phoneSize],
    foodImageSizeScale: foodImageScaleBySize[phoneSize] * compactFactor,
    foodCardLabelFontSize: foodCardLabelBySize[phoneSize],
    foodCardNumberFontSize: foodCardNumberBySize[phoneSize],
    foodCardDescriptionFontSize,
    foodCardDescriptionLineHeight: clamp(foodCardDescriptionFontSize * 1.7, 18, 28),
    switcherPadding: switcherPaddingBySize[phoneSize],
    switcherRadius: 24,
    switcherItemPaddingVertical: clamp(8 * compactFactor, 6, 10),
    switcherFontSize: switcherFontBySize[phoneSize],
    calendarDaySize: clamp(shortestSide * 0.115 * compactFactor, 36, 48),
    calendarHeaderFontSize: calendarHeaderBySize[phoneSize],
    calendarNavFontSize: calendarNavBySize[phoneSize],
    calendarWeekdayFontSize: calendarWeekdayBySize[phoneSize],
    calendarDayFontSize: calendarDayBySize[phoneSize],
  };
}
