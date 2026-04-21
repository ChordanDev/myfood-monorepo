import Svg, { Path } from 'react-native-svg';
import { ShadowSurface } from '@/components';
import type { MockMealType } from '@/mocks';

interface FoodCardProps {
  mealType: MockMealType | null;
  description: string | null;
}

const FOOD_CARD_SHAPE_PATH = [
  'M4 52.2353V209.461C4 226.03 17.4315 239.507 34 239.507H236.455C261.276 239.507 275.36 211.083 260.324 191.334L185.931 93.6195C178.944 84.4422 177.837 72.072 183.084 61.8002L192.345 43.6688C203.565 21.7033 184.958 -3.66386 160.637 0.44048L29.0079 22.6536C14.5699 25.0901 4 37.5932 4 52.2353Z',
].join(' ');

function FoodCard({ mealType, description }: FoodCardProps) {
  const hasMealData = Boolean(mealType || description?.trim());

  return (
    <ShadowSurface className="h-full w-full">
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 271 239.507"
        preserveAspectRatio="none"
        accessible={false}>
        <Path d={FOOD_CARD_SHAPE_PATH} fill={hasMealData ? '#364025' : '#2F3D22'} />
      </Svg>
    </ShadowSurface>
  );
}

export { FoodCard };
export default FoodCard;
