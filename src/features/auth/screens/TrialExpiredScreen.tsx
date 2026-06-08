import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface TrialExpiredScreenProps {
  email?: string;
  isSigningOut?: boolean;
  onSignOut: () => void;
}

export function TrialExpiredScreen({
  email,
  isSigningOut = false,
  onSignOut,
}: TrialExpiredScreenProps) {
  const { theme } = useRecipeTheme();

  return (
    <LinearGradient
      colors={[theme.colorBlack, theme.colorDark, theme.colorMedium]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <View className="flex-1 justify-center px-7">
          <View className="rounded-3xl px-6 py-8" style={{ backgroundColor: theme.icon }}>
            <Text
              className="text-center font-montserrat-bold text-[30px]"
              style={{ color: theme.colorMedium }}>
              Tu prueba terminó
            </Text>
            <Text
              className="font-inter-regular mt-4 text-center text-base"
              style={{ color: theme.textMedium }}>
              Para seguir usando MyFood, necesitás activar tu cuenta cuando la suscripción esté
              disponible.
            </Text>
            {email ? (
              <Text
                selectable
                className="mt-4 text-center font-inter-medium text-sm"
                style={{ color: theme.textLight }}>
                Sesión iniciada como {email}
              </Text>
            ) : null}

            <Pressable
              onPress={onSignOut}
              disabled={isSigningOut}
              className="mt-7 items-center rounded-2xl py-4 active:opacity-90"
              style={{ backgroundColor: theme.colorMedium, opacity: isSigningOut ? 0.6 : 1 }}>
              {isSigningOut ? (
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              ) : (
                <Text
                  className="font-inter-semibold text-base"
                  style={{ color: theme.primaryAccent }}>
                  Cerrar sesión
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaContent>
    </LinearGradient>
  );
}
