import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent } from '../src/components';

export default function HomeRoute() {
  return (
    <LinearGradient
      colors={['#111309', '#191D0D', '#242B12']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className="flex-1"
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.16} />
      <SafeAreaContent>
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center font-montserrat-bold text-3xl text-[#F7F2E8]">
            Pantalla principal
          </Text>
          <Text className="font-inter-regular mt-3 text-center text-base text-[#D8D98B]">
            Este es un placeholder de Home para el flujo de login OTP.
          </Text>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
