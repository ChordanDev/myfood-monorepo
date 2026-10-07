import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@/constants/theme';

interface PlaceholderScreenProps {
  title: string;
}

/**
 * Pantalla placeholder reutilizable para tabs aun no implementados.
 */
export function PlaceholderScreen({ title }: PlaceholderScreenProps) {
  return (
    <View style={[styles.screen, { backgroundColor: COLORS.bgDarkest }]}>
      <Text style={[styles.title, { color: COLORS.textLight }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 21,
  },
});
