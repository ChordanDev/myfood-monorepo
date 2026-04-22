import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { ShadowSurface } from '@/components';
import type { MockMealType } from '@/mocks';
import { parseDateKey, startOfDay } from '../utils/calendarDate';

interface FoodCardProps {
  mealType: MockMealType | null;
  description: string | null;
  selectedDate: string | null;
}

const FOOD_CARD_SHAPE_PATH =
  'M4 52.2354V209.462C4 226.03 17.4315 239.507 34 239.507H236.455C261.276 239.507 275.36 211.083 260.324 191.334L185.931 93.6196C178.944 84.4424 177.837 72.0721 183.084 61.8003L192.345 43.6689C203.565 21.7035 184.958 -3.66374 160.637 0.440602L29.0079 22.6537C14.5699 25.0902 4 37.5933 4 52.2354Z';
const FOOD_CARD_GRADIENT_ACTIVE_ID = 'foodCardGradientActive';
const FOOD_CARD_GRADIENT_EMPTY_ID = 'foodCardGradientEmpty';

const SPANISH_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
});

function getTopLeftLabel(selectedDate: string | null) {
  if (!selectedDate) {
    return '';
  }

  const selectedDay = startOfDay(parseDateKey(selectedDate));
  const today = startOfDay(new Date());

  if (selectedDay.getTime() === today.getTime()) {
    return 'HOY';
  }

  const weekday = SPANISH_WEEKDAY_FORMATTER.format(selectedDay);
  const weekdayLabel = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${weekdayLabel} ${selectedDay.getDate()}`;
}

function FoodCard({ mealType, description, selectedDate }: FoodCardProps) {
  const hasMealData = Boolean(mealType || description?.trim());
  const topLeftLabel = getTopLeftLabel(selectedDate);
  const descriptionText = description?.trim() ?? '';

  return (
    <ShadowSurface className="h-full w-full">
      <View className="relative h-full w-full">
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 271 248"
          preserveAspectRatio="none"
          accessible={false}>
          <Defs>
            <LinearGradient
              id={FOOD_CARD_GRADIENT_ACTIVE_ID}
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor="#364025" />
              <Stop offset="0.778846" stopColor="#1B210E" />
            </LinearGradient>
            <LinearGradient
              id={FOOD_CARD_GRADIENT_EMPTY_ID}
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor="#2F3D22" />
              <Stop offset="0.778846" stopColor="#1B210E" />
            </LinearGradient>
          </Defs>
          <Path
            d={FOOD_CARD_SHAPE_PATH}
            fill={`url(#${hasMealData ? FOOD_CARD_GRADIENT_ACTIVE_ID : FOOD_CARD_GRADIENT_EMPTY_ID})`}
          />
        </Svg>

        <View className="absolute inset-0 px-4 py-3">
          {topLeftLabel ? (
            <Text
              className="font-montserrat-alt-black text-xl text-[#F6F2E8]"
              style={{ letterSpacing: 1 }}>
              {topLeftLabel}
            </Text>
          ) : null}

          <View className="flex-1 items-center justify-center px-3 pb-2">
            <Text
              className="text-center font-inter-semibold text-base leading-6 text-[#F6F2E8]"
              numberOfLines={5}>
              {descriptionText}
            </Text>
          </View>
        </View>
      </View>
    </ShadowSurface>
  );
}

export { FoodCard };
export default FoodCard;
