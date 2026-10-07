import type { HomeMetrics } from '../../utils/responsive';
import {
  FOOD_CARD_TOP_ICON_BOX_PERCENT,
  FOOD_CARD_TOP_ICON_SCALE,
  FOOD_CARD_BOTTOM_ICON_BOX_PERCENT,
  FOOD_CARD_BOTTOM_ICON_SCALE,
  FOOD_CARD_LABEL_CENTER_PERCENT,
  FOOD_CARD_LABEL_WIDTH_PERCENT,
  FOOD_CARD_DESCRIPTION_CENTER_PERCENT,
  FOOD_CARD_DESCRIPTION_WIDTH_PERCENT,
} from './constants';

export function useFoodCardLayout(metrics: HomeMetrics) {
  const topIconBoxSize = `${FOOD_CARD_TOP_ICON_BOX_PERCENT * FOOD_CARD_TOP_ICON_SCALE}%`;
  const bottomIconBoxSize = `${FOOD_CARD_BOTTOM_ICON_BOX_PERCENT * FOOD_CARD_BOTTOM_ICON_SCALE}%`;
  const bottomIconSize = Math.round(24 * FOOD_CARD_BOTTOM_ICON_SCALE);
  const dayLabelLeft = `${FOOD_CARD_LABEL_CENTER_PERCENT - FOOD_CARD_LABEL_WIDTH_PERCENT / 2}%`;
  const dayLabelWidth = `${FOOD_CARD_LABEL_WIDTH_PERCENT}%`;
  const descriptionLeft = `${
    FOOD_CARD_DESCRIPTION_CENTER_PERCENT - FOOD_CARD_DESCRIPTION_WIDTH_PERCENT / 2
  }%`;
  const descriptionWidth = `${FOOD_CARD_DESCRIPTION_WIDTH_PERCENT}%`;

  return {
    topIconBoxSize,
    bottomIconBoxSize,
    bottomIconSize,
    dayLabelLeft,
    dayLabelWidth,
    descriptionLeft,
    descriptionWidth,
  };
}
