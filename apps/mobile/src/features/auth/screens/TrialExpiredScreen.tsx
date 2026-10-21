import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

type SubscribeStatus = 'idle' | 'opening' | 'confirming' | 'pending' | 'error';

interface TrialExpiredScreenProps {
  email?: string;
  isSigningOut?: boolean;
  onSignOut: () => void;
  /** Whether this build can sell the subscription (it has a RevenueCat key). */
  canSubscribe?: boolean;
  subscribeStatus?: SubscribeStatus;
  /** Copy for a pending confirmation or an error, shown under the buttons. */
  subscribeMessage?: string | null;
  onSubscribe?: () => void;
  /** Asks the server again after a pending purchase. */
  onCheckAgain?: () => void;
}

export function TrialExpiredScreen({
  email,
  isSigningOut = false,
  onSignOut,
  canSubscribe = false,
  subscribeStatus = 'idle',
  subscribeMessage = null,
  onSubscribe,
  onCheckAgain,
}: TrialExpiredScreenProps) {
  const { theme } = useRecipeTheme();
  const isBusy = subscribeStatus === 'opening' || subscribeStatus === 'confirming';
  const isPending = subscribeStatus === 'pending';
  const showSubscribe = canSubscribe && onSubscribe !== undefined;
  const primaryAction = isPending ? onCheckAgain : onSubscribe;
  const primaryLabel = isPending ? 'Revisar de nuevo' : 'Suscribirme';

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
              {showSubscribe
                ? 'Suscribite para seguir usando MyFood con toda tu cuenta.'
                : 'Para seguir usando MyFood, necesitás activar tu cuenta cuando la suscripción esté disponible.'}
            </Text>
            {email ? (
              <Text selectable style={[styles.email, { color: theme.textLight }]}>
                Sesión iniciada como {email}
              </Text>
            ) : null}

            {showSubscribe ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: isBusy, busy: isBusy }}
                testID="trial-expired-subscribe"
                onPress={primaryAction}
                disabled={isBusy || isSigningOut}
                style={({ pressed }) => [
                  styles.subscribeButton,
                  {
                    backgroundColor: theme.primaryAccent,
                    borderColor: theme.primaryAccentIntense,
                    opacity: isBusy ? 0.6 : pressed ? 0.9 : 1,
                  },
                ]}>
                {isBusy ? <ActivityIndicator size="small" color={theme.textBlack} /> : null}
                <Text style={[styles.buttonLabel, { color: theme.textBlack }]}>
                  {subscribeStatus === 'confirming' ? 'Confirmando tu suscripción…' : primaryLabel}
                </Text>
              </Pressable>
            ) : null}

            {showSubscribe && subscribeMessage ? (
              <Text
                testID="trial-expired-subscribe-message"
                accessibilityLiveRegion="polite"
                style={[
                  styles.message,
                  { color: subscribeStatus === 'error' ? theme.alert : theme.textLight },
                ]}>
                {subscribeMessage}
              </Text>
            ) : null}

            <Pressable
              testID="trial-expired-sign-out"
              onPress={onSignOut}
              disabled={isSigningOut || isBusy}
              style={({ pressed }) => [
                styles.signOutButton,
                {
                  marginTop: showSubscribe ? 14 : 24.5,
                  backgroundColor: theme.colorMedium,
                  opacity: isSigningOut ? 0.6 : pressed ? 0.9 : 1,
                },
              ]}>
              {isSigningOut ? (
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              ) : (
                <Text style={[styles.buttonLabel, { color: theme.primaryAccent }]}>
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
  buttonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
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
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 17.5,
    marginTop: 14,
    textAlign: 'center',
  },
  signOutButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
  },
  subscribeButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 24.5,
    paddingVertical: 14,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 30,
    textAlign: 'center',
  },
});
