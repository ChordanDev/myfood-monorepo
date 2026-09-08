import { Text, View } from 'react-native';
import type { OnboardingTheme } from '@/features/preferences/components/onboarding/OnboardingSectionCard';

interface OnboardingHeroProps {
  isCompact: boolean;
  theme: OnboardingTheme;
}

export function OnboardingHero({ isCompact, theme }: OnboardingHeroProps) {
  return (
    <View style={{ gap: 18, paddingHorizontal: 2, paddingTop: 10 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}>
        <View
          style={{
            backgroundColor: theme.colorBlack,
            borderRadius: 28,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}>
          <Text
            style={{
              color: theme.primaryAccent,
              fontFamily: 'Inter_600SemiBold',
              fontSize: 10.5,
              lineHeight: 14,
            }}>
            ONBOARDING
          </Text>
        </View>
        <View
          style={{
            backgroundColor: 'rgba(69, 64, 47, 0.68)',
            borderRadius: 28,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}>
          <Text
            style={{
              color: theme.textLight,
              fontFamily: 'Inter_600SemiBold',
              fontSize: 10.5,
              lineHeight: 14,
            }}>
            3 pasos
          </Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text
          style={{
            color: theme.textBlack,
            fontFamily: 'Montserrat_700Bold',
            fontSize: isCompact ? 42 : 48,
            letterSpacing: -1.6,
            textAlign: 'center',
          }}>
          TU COCINA
        </Text>
        <Text
          style={{
            color: theme.colorMedium,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 14,
            lineHeight: 23,
            maxWidth: 320,
            textAlign: 'center',
          }}>
          Armemos un perfil para que la IA piense como alguien que conoce tu casa, no como un
          buscador de recetas cualquiera.
        </Text>
      </View>

      <View
        style={{
          alignSelf: 'center',
          backgroundColor: theme.colorDark,
          borderBottomRightRadius: 34,
          borderRadius: 28,
          borderTopRightRadius: 68,
          maxWidth: 340,
          minHeight: 148,
          overflow: 'hidden',
          padding: 18,
          width: '100%',
        }}>
        <View
          style={{
            backgroundColor: theme.icon,
            borderRadius: 999,
            height: 94,
            position: 'absolute',
            right: -8,
            top: 18,
            width: 120,
          }}
        />
        <Text
          style={{
            color: theme.textLight,
            fontFamily: 'Montserrat_700Bold',
            fontSize: 17.5,
            lineHeight: 24.5,
          }}>
          Comer mejor,
        </Text>
        <Text
          style={{
            color: theme.primaryAccent,
            fontFamily: 'Montserrat_700Bold',
            fontSize: 17.5,
            lineHeight: 24.5,
          }}>
          sin adivinar
        </Text>
        <Text
          style={{
            color: theme.textMedium,
            fontFamily: 'Inter_500Medium',
            fontSize: 12.25,
            lineHeight: 20,
            marginTop: 12,
            maxWidth: 210,
          }}>
          Contanos gustos, restricciones y tiempos. Nosotros convertimos eso en decisiones.
        </Text>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: theme.colorBlack,
            borderColor: theme.primaryAccent,
            borderRadius: 999,
            borderWidth: 2,
            bottom: 16,
            height: 56,
            justifyContent: 'center',
            position: 'absolute',
            right: 16,
            width: 56,
          }}>
          <Text
            style={{
              color: theme.primaryAccent,
              fontFamily: 'Montserrat_700Bold',
              fontSize: 26.25,
              lineHeight: 31.5,
            }}>
            +
          </Text>
        </View>
      </View>
    </View>
  );
}
