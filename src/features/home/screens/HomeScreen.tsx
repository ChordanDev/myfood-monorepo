import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { useTitleMetrics } from '@/hooks/useTitleMetrics';
import { mockPlanByDate } from '@/mocks';
import { Calendar } from '../components';

export function HomeScreen() {
  const metrics = useTitleMetrics();
  const planByDate = mockPlanByDate;

  return (
    <LinearGradient
      colors={['#17180E', '#565A41', '#E5D8C4']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.05, 0.15]}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent includeBottom={false} style={{ flex: 1 }}>
        <TitlePrimary text="COMIDAS" metrics={metrics} />
        <View className="flex-1 items-center gap-2 px-3 pb-5">
          <View className="w-full rounded-lg" style={{ flex: 1 }}>
            <View className="h-16 w-16 rounded-full bg-[#27291e]" />
          </View>
          <View className="w-full flex-row gap-2" style={{ flex: 4 }}>
            <View className="rounded-3xl bg-[#27291e]" style={{ flex: 5 }} />
            <View className="rounded-full bg-[#27291e]" style={{ flex: 4 }} />
          </View>
          <View className="w-full" style={{ flex: 6 }}>
            <Calendar planByDate={planByDate} daySize={44} viewportHeight={320} minHeight={370} />
          </View>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
