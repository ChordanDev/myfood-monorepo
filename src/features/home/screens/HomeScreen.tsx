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
        <View className="w-full flex-1 px-4">
          <View className="flex-1">
            <View className="aspect-square h-1 rounded-full bg-black" />
          </View>
          <View className="flex-2 bg-red-500">
            <View className="w-2/3 bg-black"></View>
          </View>
          <View className="h-3/6 w-full self-end">
            <Calendar planByDate={planByDate} daySize={44} viewportHeight={320} minHeight={370} />
          </View>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
