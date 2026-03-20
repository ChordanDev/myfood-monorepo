import { Pressable, Text, View } from 'react-native';

export function AuthLandingScreen() {
  return (
    <View className="flex-1 bg-[#ECE6DA] px-8">
      <View className="flex-1 items-center justify-center">
        <Text className="mb-16 text-6xl font-extrabold text-[#1F2C14]">MyFood</Text>

        <Pressable className="mb-5 w-full items-center rounded-3xl border-2 border-[#354B22] bg-[#9CA574] py-4">
          <Text className="text-4xl font-semibold text-[#1F2C14]">Iniciar Sesion</Text>
        </Pressable>

        <Pressable className="w-full items-center rounded-3xl bg-[#2E4420] py-4">
          <Text className="text-4xl font-semibold text-[#ECE6DA]">Registrarse</Text>
        </Pressable>
      </View>
    </View>
  );
}
