import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { NoisyBackground } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { PlannerHeader, PlannerChatInput } from '../components';

export const PlannerScreen = () => {
  const { theme } = useRecipeTheme();

  return (
    <View className="flex-1" style={{ backgroundColor: theme.appBg }}>
      <NoisyBackground opacity={0.3} />

      <PlannerHeader />

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

      <PlannerChatInput />
    </View>
  );
};
