import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent, TitlePrimary, TopFadeMask } from '@/components';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';

export function HomeScreen() {
  // Placeholder de Home para el flujo de login.
  const metrics = useResponsiveScale();

  return (
    <LinearGradient
      colors={['#17180E', '#565A41', '#E5D8C4']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.05, 0.15]}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View className="flex-1 bg-gray-300">
          <View className="w-full rounded-lg  bg-[#899064] p-2" style={{ flex: 1 }}>
            <View className="max-w-48 items-start rounded-lg bg-[#27291e]" style={{ flex: 1 }} />
          </View>
          <View className="w-full rounded-lg bg-[#899064]" style={{ flex: 3 }} />
          <View className="w-full rounded-lg bg-[#899064]" style={{ flex: 3 }} />
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
