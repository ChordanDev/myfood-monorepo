import { ImageBackground, Pressable, Text, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SocialLoginIcons } from '../components/SocialLoginIcons';
import { LinearGradient } from 'expo-linear-gradient';



export function AuthLandingScreen() {
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
        colors={['#E5D8C4', '#242B12']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 1 }}
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
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                justifyContent: 'space-between',
            }}
        >
            <View className="items-center">

                {/* TITULO */}
                <View className="justify-start items-center pt-4 mb-10" style={{ paddingHorizontal: 32 }}>
                    <Text className="text-[48px] font-montserrat-bold text-[#242B12]">MyFood</Text>
                </View>

                {/* IMAGENES PLATOS */}
<View
  style={{
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  }}
>
  {[
    require('/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_6g6mrd6g6mrd6g6m-removebg-preview.png'),
    require('/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_16g8h616g8h616g8-removebg-preview.png'),
    require('/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_pg509gpg509gpg50-removebg-preview.png'),
    require('/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_pw980xpw980xpw98-removebg-preview.png'),
    require('/Users/luccagiordana/Documents/proyectoApp/my-expo-app/assets/AuthFoodImages/Gemini_Generated_Image_urgyfkurgyfkurgy-removebg-preview.png'),
  ].map((source, index) => {
    const centerIndex = 2; // el del medio
    const diff = index - centerIndex;

    const scale =
      diff === 0 ? 1 :
      Math.abs(diff) === 1 ? 0.75 :
      0.55;

    const size = 180 * scale;

    const translateX =
      diff === 0 ? 0 :
      diff === -1 ? -90 :
      diff === 1 ? 90 :
      diff === -2 ? -150 :
      150;

    return (
      <Image
        key={index}
        source={source}
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,

          transform: [{ translateX }],

          zIndex: 10 - Math.abs(diff),
        }}
        resizeMode="cover"
      />
    );
  })}
</View>

            </View>

            <View className="content-start" style={{ flexShrink: 0, paddingHorizontal: 32 }}>

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
                <View className='justify-end items-center pt-16 pb-10'>
                    <Text className="mb-3 text-[16px] font-inter-medium text-[#cbd8aa]">Iniciar sesión con</Text>
                    <View className="mb-6 h-[1px] w-6/12 bg-[#D8D98B] opacity-50" />

                    <SocialLoginIcons />

                </View>
            </View>
        </View>  
    </LinearGradient>

  );
}
