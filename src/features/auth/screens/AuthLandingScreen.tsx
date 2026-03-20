import { Pressable, Text, View } from 'react-native';

export function AuthLandingScreen() {
  return (
    <View className="flex-1 bg-[#E5D8C4] px-8">
        <View className="flex-1 bg-[#E5D8C4] px-8 pt-16">
            <View className="items-center">
                <Text className="mb-16 text-6xl font-montserrat-extrabold text-[#242B12]">MyFood</Text>
            </View>
        </View>
        <View className='flex-1 justify-center'>
            <Pressable className="mb-5 w-full items-center rounded-2xl border-2 border-[#364025] bg-[#899064] py-4">
            <Text className="text-[20px] font-inter-medium text-[#242B12]">Iniciar Sesion</Text>
            </Pressable>

            <Pressable className="w-full items-center rounded-2xl bg-[#364025] py-4">
            <Text className="text-[20px] font-inter-semibold text-[#D8D98B]">Registrarse</Text>
            </Pressable>
        </View>
    </View>
  );
}
