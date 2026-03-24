import { ImageBackground, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SocialLoginIcons } from '../components/SocialLoginIcons';
import { LinearGradient } from 'expo-linear-gradient';


export function AuthLandingScreen() {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
        colors={['#E5D8C4', '#242B12']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        locations={[0, 0.63]}
        style={{ flex: 1 }}
        >
        <ImageBackground
            source={require('../../../../assets/noisy-background.jpg')}
            resizeMode="repeat"
            style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                opacity: 0.2,
            }}
        />

        <View
            style={{
                flex: 1,
                paddingHorizontal: 32,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                justifyContent: 'space-between',
            }}
        >
            <View className="items-center">
                {/* TITULO */}
                <View className="justify-start items-center pt-4 mb-32">
                    <Text className="text-[48px] font-montserrat-bold text-[#242B12]">MyFood</Text>
                </View>

                {/* SECCION FOTOS */}
                <View className="justify-start items-center">
                    <Text className="text-[24px] font-inter-medium text-[#242B12]">Fotos</Text>
                </View>
            </View>

            <View className="content-start">
                {/* BOTONES */}
                <View className=''>

                    {/* BOTON INICIAR SESION */}
                    <Pressable className="mb-5 w-full rounded-3xl bg-[#899064] items-center py-5">
                        <Text className="text-[18px] font-inter-medium text-[#242B12]">Iniciar Sesión</Text>
                    </Pressable>
        
                    {/* BOTON REGISTRARSE */}
                    <Pressable className="w-full items-center rounded-3xl bg-[#242B12] py-5">
                        <Text className="text-[18px] font-inter-medium text-[#D8D98B]">Registrarse</Text>
                    </Pressable>
                </View>

                {/* SECCION SOCIAL */}
                <View className='justify-end items-center pt-16 pb-8'>
                    <Text className="mb-3 text-[16px] font-inter-medium text-[#242B12]">Iniciar sesión con</Text>
                    <View className="mb-6 h-[1px] w-6/12 bg-[#D8D98B] opacity-50" />

                    <SocialLoginIcons />
                </View>
            </View>
        </View>  
    </LinearGradient>

  );
}
