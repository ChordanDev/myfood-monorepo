import { Text, View } from 'react-native';
import { COLORS } from '@/constants/theme';

interface PlaceholderScreenProps {
  title: string;
}

/**
 * Pantalla placeholder reutilizable para tabs aun no implementados.
 */
export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: COLORS.bgDarkest }}>
      <Text style={{ color: COLORS.textLight }} className="font-inter-medium text-base">
        {title}
      </Text>
    </View>
  );
}
