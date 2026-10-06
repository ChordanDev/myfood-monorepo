import {
  clamp,
  getPhoneSizeBucket,
  getTitleMetrics,
  scaleByBucket,
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
  pendingCardRadius: number;
  confirmButtonSize: number;
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

  const cardColumn = scaleByBucket(phoneSize, [70, 72, 75, 76]);
  const foodCardDescriptionFontSize = scaleByBucket(phoneSize, [13, 14, 15, 16]);

  return {
    screenWidth: width,
    screenHeight: height,
    isLandscape,
    phoneSize,
    ...titleMetrics,
    horizontalPadding: scaleByBucket(phoneSize, [12, 14, 16, 20]),
    bottomPadding: scaleByBucket(phoneSize, [12, 14, 16, 18]),
    sectionGap: scaleByBucket(phoneSize, [12, 14, 16, 18]),
    rowGap: scaleByBucket(phoneSize, [10, 12, 14, 16]),
    cardColumnPercent: cardColumn,
    sideColumnPercent: 100 - cardColumn,
    addButtonSize: clamp(scaleByBucket(phoneSize, [64, 65, 68, 70]) * compactFactor, 50, 72),
    foodImageLeftPercent: scaleByBucket(phoneSize, [74, 76, 78, 80]),
    foodImageTopPercent: scaleByBucket(phoneSize, [30, 30, 30, 30]),
    foodImageWidthPercent: scaleByBucket(phoneSize, [38, 40, 40, 42]),
    foodImageSizeScale: scaleByBucket(phoneSize, [1.75, 1.7, 1.65, 1.6]) * compactFactor,
    foodCardLabelFontSize: scaleByBucket(phoneSize, [16, 17, 18, 19]),
    foodCardNumberFontSize: scaleByBucket(phoneSize, [18, 19, 20, 21]),
    foodCardDescriptionFontSize,
    foodCardDescriptionLineHeight: clamp(foodCardDescriptionFontSize * 1.7, 18, 28),
    pendingCardRadius: 30,
    confirmButtonSize: scaleByBucket(phoneSize, [38, 40, 42, 44]),
    switcherPadding: scaleByBucket(phoneSize, [6, 7, 8, 9]),
    switcherRadius: 24,
    switcherItemPaddingVertical: clamp(8 * compactFactor, 6, 10),
    switcherFontSize: scaleByBucket(phoneSize, [12, 13, 14, 15]),
    calendarDaySize: clamp(shortestSide * 0.115 * compactFactor, 36, 48),
    calendarHeaderFontSize: scaleByBucket(phoneSize, [17, 18, 19, 20]),
    calendarNavFontSize: scaleByBucket(phoneSize, [18, 19, 20, 20]),
    calendarWeekdayFontSize: scaleByBucket(phoneSize, [12, 13, 14, 14]),
    calendarDayFontSize: scaleByBucket(phoneSize, [13, 14, 15, 16]),
  };
}
