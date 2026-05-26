import React, { useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Calendar, Check, Plus, Mic } from 'lucide-react-native';
import { NoisyBackground } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

export const PlannerScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();

  // Rotation for the thinking border gradient
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotateZ: `${rotation.value}deg` }],
    };
  });

  return (
    <View className="flex-1" style={{ backgroundColor: theme.appBg }}>
      {/* Background Texture */}
      <NoisyBackground opacity={0.3} />

      {/* Header */}
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

      {/* Chat Area */}
      <ScrollView
        className="mt-6 flex-1 px-5"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}>
        {/* User Message 1 */}
        <View
          className="mb-8 max-w-[92%] self-end rounded-3xl rounded-tr-xl p-5 shadow-sm"
          style={{ backgroundColor: theme.colorLight }}>
          <Text
            className="text-[17px] font-medium leading-relaxed"
            style={{ color: theme.textBlack }}>
            EL domingo a la noche vienen 5 personas a mi casa y son vegetarianos. Despues el sabado
            tengo que preparar algo para llevar al a iglesia, para compartir pero son bastantes como
            30 personas
          </Text>
        </View>

        {/* AI Message */}
        <View className="mb-8 px-1">
          <Text
            className="text-[19px] font-bold leading-relaxed"
            style={{ color: theme.textBlack }}>
            Te parece para el domingo hacer unos tacos vegetarianos? y para el sábado llevar unas
            empanadas de choclo y verdura?
          </Text>
        </View>

        {/* User Message 2 */}
        <View
          className="mb-6 self-end rounded-[28px] rounded-tr-xl px-6 py-4 shadow-sm"
          style={{ backgroundColor: theme.colorLight }}>
          <Text className="text-[17px] font-medium" style={{ color: theme.textBlack }}>
            Si, me parece perfecto
          </Text>
        </View>
      </ScrollView>

      {/* Input Area */}
      <View
        className="absolute bottom-0 w-full px-4"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View className="relative h-[72px] w-full items-center justify-center overflow-hidden rounded-full shadow-lg">
          {/* Animated Gradient Background */}
          <Animated.View className="absolute h-[400%] w-[400%]" style={animatedStyle}>
            <LinearGradient
              colors={[
                theme.primaryAccent,
                theme.colorLight,
                theme.colorBlack,
                theme.primaryAccent,
              ]}
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
    </View>
  );
};
