import { Text, View } from 'react-native';
import type { MockMealType } from '@/mocks';

interface FoodCardProps {
  mealType: MockMealType | null;
  description: string | null;
}

const MEAL_TYPE_LABEL: Record<MockMealType, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  cena: 'Cena',
};

function FoodCard({ mealType, description }: FoodCardProps) {
  const title = mealType ? MEAL_TYPE_LABEL[mealType] : 'Sin comida planificada';
  const body = description?.trim()
    ? description
    : mealType
      ? 'No hay una comida planificada para este tipo en el dia seleccionado.'
      : 'Selecciona un dia del calendario para ver la descripcion de la comida.';

  return (
    <View className="h-full w-full overflow-hidden rounded-3xl bg-[#364025] px-4 py-4">
      <Text className="font-inter-semibold text-xs uppercase text-[#D8D98B]">Comida sugerida</Text>
      <Text className="mt-1 font-montserrat-bold text-2xl text-[#F6F2E8]">{title}</Text>
      <View className="mt-3 h-px" style={{ backgroundColor: 'rgba(216, 217, 139, 0.35)' }} />
      <Text className="mt-3 font-inter text-base leading-6 text-[#F6F2E8]">{body}</Text>
    </View>
  );
}

export { FoodCard };
export default FoodCard;
