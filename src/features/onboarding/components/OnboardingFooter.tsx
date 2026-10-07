import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ArrowRight, Check, CircleAlert } from 'lucide-react-native';
import { ShadowSurface } from '@/components';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingFooterProps {
  /** Why the last attempt to leave the step failed, or `null`. */
  errorMessage: string | null;
  /** The last step submits instead of moving on. */
  isLastStep: boolean;
  isSubmitting: boolean;
  onPrimaryPress: () => void;
  onSignOut?: () => void;
  primaryDisabled: boolean;
  theme: RecipeThemeConfig;
}

// Sits below the scroll area so the primary action never scrolls away.
export function OnboardingFooter({
  errorMessage,
  isLastStep,
  isSubmitting,
  onPrimaryPress,
  onSignOut,
  primaryDisabled,
  theme,
}: OnboardingFooterProps) {
  const PrimaryIcon = isLastStep ? Check : ArrowRight;

  return (
    <View style={{ alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingTop: 12 }}>
      {errorMessage !== null ? (
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{ alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
          <CircleAlert color={theme.textDark} size={18} strokeWidth={2.5} />
          <Text
            selectable
            style={{
              color: theme.textDark,
              flexShrink: 1,
              fontFamily: 'Inter_600SemiBold',
              fontSize: 14,
              lineHeight: 20,
            }}>
            {errorMessage}
          </Text>
        </View>
      ) : null}

      <ShadowSurface
        style={{
          alignSelf: 'stretch',
          backgroundColor: theme.colorDark,
          borderRadius: 28,
          opacity: primaryDisabled ? 0.5 : 1,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting, disabled: primaryDisabled }}
          disabled={primaryDisabled}
          onPress={onPrimaryPress}
          style={({ pressed }) => ({
            alignItems: 'center',
            flexDirection: 'row',
            gap: 10,
            height: 56,
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}>
          {isSubmitting ? (
            <ActivityIndicator color={theme.primaryAccent} size="small" />
          ) : (
            <>
              <Text
                style={{
                  color: theme.textLight,
                  fontFamily: 'Montserrat_600SemiBold',
                  fontSize: 15,
                  letterSpacing: 0.8,
                  lineHeight: 20,
                }}>
                {isLastStep ? 'FINALIZAR' : 'CONTINUAR'}
              </Text>
              <PrimaryIcon color={theme.primaryAccent} size={20} strokeWidth={2.5} />
            </>
          )}
        </Pressable>
      </ShadowSurface>

      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => ({
          justifyContent: 'center',
          minHeight: 44,
          opacity: pressed ? 0.6 : 1,
          paddingHorizontal: 16,
        })}>
        <Text
          style={{
            color: withOpacity(theme.textBlack, 0.8),
            fontFamily: 'Inter_600SemiBold',
            fontSize: 14,
            lineHeight: 20,
          }}>
          Cerrar sesión
        </Text>
      </Pressable>
    </View>
  );
}
