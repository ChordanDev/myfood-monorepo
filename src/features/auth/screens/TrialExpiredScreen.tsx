import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: theme.icon }]}>
            <Text style={[styles.title, { color: theme.colorMedium }]}>Tu prueba terminó</Text>
            <Text style={[styles.body, { color: theme.textMedium }]}>
              Para seguir usando MyFood, necesitás activar tu cuenta cuando la suscripción esté
              disponible.
            </Text>
            {email ? (
              <Text selectable style={[styles.email, { color: theme.textLight }]}>
                Sesión iniciada como {email}
              </Text>
            ) : null}

            <Pressable
              onPress={onSignOut}
              disabled={isSigningOut}
              style={({ pressed }) => [
                styles.signOutButton,
                {
                  backgroundColor: theme.colorMedium,
                  opacity: isSigningOut ? 0.6 : pressed ? 0.9 : 1,
                },
              ]}>
              {isSigningOut ? (
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              ) : (
                <Text style={[styles.signOutLabel, { color: theme.primaryAccent }]}>
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

const styles = StyleSheet.create({
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 14,
    textAlign: 'center',
  },
  card: {
    borderRadius: 21,
    paddingHorizontal: 21,
    paddingVertical: 28,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24.5,
  },
  email: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 17.5,
    marginTop: 14,
    textAlign: 'center',
  },
  signOutButton: {
    alignItems: 'center',
    borderRadius: 14,
    marginTop: 24.5,
    paddingVertical: 14,
  },
  signOutLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 30,
    textAlign: 'center',
  },
});
