import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
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
const FOOD_CARD_ICON_COLOR = '#D8D98B';
const FOOD_CARD_TOP_ICON_SCALE = 1;
const FOOD_CARD_BOTTOM_ICON_SCALE = 1.2;
const FOOD_CARD_TOP_ICON_BOX_PERCENT = 10;
const FOOD_CARD_BOTTOM_ICON_BOX_PERCENT = 10.5;

function FavoriteStarIcon() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.7499 4.5C11.6589 4.5 11.4349 4.525 11.3159 4.763L9.48992 8.414C9.20092 8.991 8.64392 9.392 7.99992 9.484L3.91192 10.073C3.64192 10.112 3.54992 10.312 3.52192 10.396C3.49692 10.477 3.45692 10.683 3.64292 10.861L6.59892 13.701C7.06992 14.154 7.28392 14.807 7.17192 15.446L6.47592 19.456C6.43292 19.707 6.58992 19.853 6.65992 19.903C6.73392 19.959 6.93192 20.07 7.17692 19.942L10.8319 18.047C11.4079 17.75 12.0939 17.75 12.6679 18.047L16.3219 19.941C16.5679 20.068 16.7659 19.957 16.8409 19.903C16.9109 19.853 17.0679 19.707 17.0249 19.456L16.3269 15.446C16.2149 14.807 16.4289 14.154 16.8999 13.701L19.8559 10.861C20.0429 10.683 20.0029 10.476 19.9769 10.396C19.9499 10.312 19.8579 10.112 19.5879 10.073L15.4999 9.484C14.8569 9.392 14.2999 8.991 14.0109 8.413L12.1829 4.763C12.0649 4.525 11.8409 4.5 11.7499 4.5ZM6.94692 21.5C6.53392 21.5 6.12392 21.37 5.77292 21.114C5.16692 20.67 4.86992 19.937 4.99892 19.199L5.69492 15.189C5.72092 15.04 5.66992 14.889 5.55992 14.783L2.60392 11.943C2.05992 11.422 1.86492 10.652 2.09492 9.937C2.32692 9.214 2.94092 8.697 3.69792 8.589L7.78592 8C7.94392 7.978 8.07992 7.881 8.14792 7.743L9.97492 4.091C10.3119 3.418 10.9919 3 11.7499 3C12.5079 3 13.1879 3.418 13.5249 4.091L15.3529 7.742C15.4219 7.881 15.5569 7.978 15.7139 8L19.8019 8.589C20.5589 8.697 21.1729 9.214 21.4049 9.937C21.6349 10.652 21.4389 11.422 20.8949 11.943L17.9389 14.783C17.8289 14.889 17.7789 15.04 17.8049 15.188L18.5019 19.199C18.6299 19.938 18.3329 20.671 17.7259 21.114C17.1109 21.565 16.3099 21.626 15.6309 21.272L11.9779 19.379C11.8349 19.305 11.6639 19.305 11.5209 19.379L7.86792 21.273C7.57592 21.425 7.26092 21.5 6.94692 21.5Z"
        fill={FOOD_CARD_ICON_COLOR}
      />
    </Svg>
  );
}

function SparklesGradientIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" accessible={false}>
      <Defs>
        <SvgLinearGradient id="sparklesMainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#F08A2B" />
          <Stop offset="0.56" stopColor="#BFD57D" />
          <Stop offset="1" stopColor="#F4F1DD" />
        </SvgLinearGradient>
        <SvgLinearGradient id="sparklesTopGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#F08A2B" />
          <Stop offset="0.56" stopColor="#BFD57D" />
          <Stop offset="1" stopColor="#F4F1DD" />
        </SvgLinearGradient>
        <SvgLinearGradient id="sparklesBottomGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#F08A2B" />
          <Stop offset="0.56" stopColor="#BFD57D" />
          <Stop offset="1" stopColor="#F4F1DD" />
        </SvgLinearGradient>
      </Defs>

      <Path
        d="M40 17L47 31L61 38L47 45L40 59L33 45L19 38L33 31L40 17Z"
        fill="url(#sparklesMainGradient)"
      />
      <Path
        d="M17 2L20.5 9L27.5 12.5L20.5 16L17 23L13.5 16L6.5 12.5L13.5 9L17 2Z"
        fill="url(#sparklesTopGradient)"
      />
      <Path
        d="M16 44L18 48L22 50L18 52L16 56L14 52L10 50L14 48L16 44Z"
        fill="url(#sparklesBottomGradient)"
      />
    </Svg>
  );
}

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
  const topIconBoxSize = `${FOOD_CARD_TOP_ICON_BOX_PERCENT * FOOD_CARD_TOP_ICON_SCALE}%`;
  const bottomIconBoxSize = `${FOOD_CARD_BOTTOM_ICON_BOX_PERCENT * FOOD_CARD_BOTTOM_ICON_SCALE}%`;
  const bottomIconSize = Math.round(24 * FOOD_CARD_BOTTOM_ICON_SCALE);

  return (
    <ShadowSurface className="h-full w-full">
      <View className="relative h-full w-full">
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 271 240"
          preserveAspectRatio="none"
          accessible={false}>
          <Defs>
            <SvgLinearGradient
              id={FOOD_CARD_GRADIENT_ACTIVE_ID}
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor="#364025" />
              <Stop offset="0.778846" stopColor="#1B210E" />
            </SvgLinearGradient>
            <SvgLinearGradient
              id={FOOD_CARD_GRADIENT_EMPTY_ID}
              x1="9"
              y1="114.507"
              x2="213.5"
              y2="302.007"
              gradientUnits="userSpaceOnUse">
              <Stop offset="0.379808" stopColor="#2F3D22" />
              <Stop offset="0.778846" stopColor="#1B210E" />
            </SvgLinearGradient>
          </Defs>
          <Path
            d={FOOD_CARD_SHAPE_PATH}
            fill={`url(#${hasMealData ? FOOD_CARD_GRADIENT_ACTIVE_ID : FOOD_CARD_GRADIENT_EMPTY_ID})`}
          />
        </Svg>

        <View className="absolute inset-0 px-4 pt-3">
          <View
            className="absolute items-center justify-center"
            style={{ right: '37%', top: '4%', width: topIconBoxSize, height: topIconBoxSize }}>
            <FavoriteStarIcon />
          </View>

          <View
            className="absolute items-center justify-center"
            style={{
              bottom: '8.5%',
              right: '8.5%',
              width: bottomIconBoxSize,
              height: bottomIconBoxSize,
            }}>
            <SparklesGradientIcon size={bottomIconSize} />
          </View>

          {topLeftLabel ? (
            <Text
              className="max-w-[72%] font-montserrat-alt-black text-xl text-[#F6F2E8]"
              style={{ letterSpacing: 1 }}>
              {topLeftLabel}
            </Text>
          ) : null}

          <View className="flex-1 items-center justify-center px-3">
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
