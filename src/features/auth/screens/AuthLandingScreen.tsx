import { ImageBackground, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useResponsiveScale } from '@/hooks/useResponsiveScale';
import { AUTH_FOOD_IMAGES } from '@/constants/authAssets';
import { AuthButton, CarouselImages, SocialDivider, SocialLoginIcons } from '../components';

export function AuthLandingScreen() {
  const insets = useSafeAreaInsets();
  const metrics = useResponsiveScale();

  return (
    <LinearGradient
      colors={['#E5D8C4', '#242B12', '#191D0D', '#111309']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      locations={[0, 0.65, 0.93, 0.98]}
      style={{ flex: 1 }}>
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

      <View style={{ flex: 1 }}>
        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            justifyContent: 'space-between',
          }}>
          <View style={{ alignItems: 'center', paddingHorizontal: metrics.horizontalPadding }}>
            <View
              style={{
                justifyContent: 'flex-start',
                alignItems: 'center',
                paddingTop: 16,
                marginBottom: metrics.titleBottomSpacing,
              }}>
              <Text
                style={{ fontSize: metrics.titleFontSize, color: '#242B12' }}
                className="font-montserrat-bold">
                MyFood
              </Text>
            </View>

            <CarouselImages images={AUTH_FOOD_IMAGES} metrics={metrics} />
          </View>

          <View
            style={{
              flexShrink: 0,
              gap: metrics.sectionGap,
              paddingHorizontal: metrics.horizontalPadding,
            }}>
            <View style={{ gap: metrics.buttonsGap }}>
              <AuthButton title="Iniciar Sesión" variant="primary" metrics={metrics} />
              <AuthButton title="Registrarse" variant="secondary" metrics={metrics} />
            </View>

            <View
              style={{
                alignItems: 'center',
                paddingTop: metrics.socialTopPadding,
                paddingBottom: metrics.socialBottomPadding,
              }}>
              <SocialDivider metrics={metrics} />
              <SocialLoginIcons
                iconSize={metrics.socialIconsSize}
                containerSize={metrics.socialIconsContainerSize}
                gap={metrics.socialIconsGap}
              />
            </View>
          </View>
        </ScrollView>
      </View>
    </LinearGradient>
  );
}
