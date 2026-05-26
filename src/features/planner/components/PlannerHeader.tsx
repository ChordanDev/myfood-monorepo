import { Pressable, Text, View } from 'react-native';
import { Calendar, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function PlannerHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();

  return (
    <View
      className="z-10 flex-row items-center justify-between px-4"
      style={{ paddingTop: Math.max(insets.top, 16) }}>
      <View
        className="flex-row items-center gap-x-3 rounded-full px-5 py-3 shadow-md"
        style={{ backgroundColor: theme.colorBlack }}>
        <Calendar size={20} color={theme.primaryAccent} strokeWidth={2.5} />
        <Text
          className="text-base font-semibold tracking-wide"
          style={{ color: theme.primaryAccent }}>
          16 - 24 Septiembre
        </Text>
      </View>
      <Pressable
        onPress={() => router.back()}
        className="rounded-full p-3 shadow-md"
        style={{ backgroundColor: theme.colorBlack }}>
        <Check size={24} color={theme.primaryAccent} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}
