import { useEffect } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Plus, Mic } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function PlannerChatInput() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${rotation.value}deg` }],
  }));

  return (
    <View
      className="absolute bottom-0 w-full px-4"
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      <View className="relative h-[72px] w-full items-center justify-center overflow-hidden rounded-full shadow-lg">
        {/* Animated Gradient Background */}
        <Animated.View className="absolute h-[400%] w-[400%]" style={animatedStyle}>
          <LinearGradient
            colors={[theme.primaryAccent, theme.colorLight, theme.colorBlack, theme.primaryAccent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ width: '100%', height: '100%' }}
          />
        </Animated.View>

        {/* Inner Dark Container */}
        <View
          className="absolute inset-[3px] z-10 flex-row items-center rounded-full px-2"
          style={{ backgroundColor: theme.colorDark }}>
          <Pressable
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: theme.colorMedium }}>
            <Plus size={24} color={theme.appBg} strokeWidth={2.5} />
          </Pressable>

          <TextInput
            className="flex-1 px-4 text-[17px]"
            style={{ color: theme.appBg }}
            placeholder="Decile a la IA lo que te gustaria"
            placeholderTextColor={theme.textLight}
          />

          <Pressable
            className="h-12 w-12 items-center justify-center rounded-full border"
            style={{ borderColor: theme.textLight }}>
            <Mic size={22} color={theme.appBg} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
