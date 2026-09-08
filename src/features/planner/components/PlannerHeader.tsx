import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Calendar, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function PlannerHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={[styles.datePill, styles.shadow, { backgroundColor: theme.colorBlack }]}>
        <Calendar size={20} color={theme.primaryAccent} strokeWidth={2.5} />
        <Text style={[styles.dateLabel, { color: theme.primaryAccent }]}>16 - 24 Septiembre</Text>
      </View>
      <Pressable
        onPress={() => router.back()}
        style={[styles.closeButton, styles.shadow, { backgroundColor: theme.colorBlack }]}>
        <Check size={24} color={theme.primaryAccent} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    borderRadius: 9999,
    padding: 10.5,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.35,
    lineHeight: 21,
  },
  datePill: {
    alignItems: 'center',
    borderRadius: 9999,
    flexDirection: 'row',
    gap: 10.5,
    paddingHorizontal: 17.5,
    paddingVertical: 10.5,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    zIndex: 10,
  },
  shadow: {
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
