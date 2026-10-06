import { Pressable, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingProgressProps {
  /** 1-based position of the step on screen. */
  currentStep: number;
  totalSteps: number;
  /** Shown as a back control at the left of the row; omit it on the first step. */
  onBack?: () => void;
  theme: RecipeThemeConfig;
}

export function OnboardingProgress({
  currentStep,
  totalSteps,
  onBack,
  theme,
}: OnboardingProgressProps) {
  const label = `Paso ${currentStep} de ${totalSteps}`;

  return (
    // The row keeps the height of the back control on every step so the
    // heading below does not jump when the control appears.
    <View style={{ alignItems: 'center', flexDirection: 'row', minHeight: 44 }}>
      {onBack ? (
        <Pressable
          accessibilityLabel="Volver al paso anterior"
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => ({
            alignItems: 'center',
            height: 44,
            justifyContent: 'center',
            // Pulls the chevron glyph back to the content edge.
            marginLeft: -10,
            opacity: pressed ? 0.6 : 1,
            width: 44,
          })}>
          <ChevronLeft color={theme.textDark} size={24} strokeWidth={2.5} />
        </Pressable>
      ) : null}
      <View
        accessible
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: totalSteps, now: currentStep }}
        style={{ alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
          {Array.from({ length: totalSteps }, (_, index) => (
            <View
              key={index}
              style={{
                backgroundColor:
                  index < currentStep ? theme.primaryAccent : withOpacity(theme.colorMedium, 0.3),
                borderRadius: 2,
                flex: 1,
                height: 4,
              }}
            />
          ))}
        </View>
        <Text
          style={{
            color: withOpacity(theme.textDark, 0.6),
            fontFamily: 'Inter_600SemiBold',
            fontSize: 13,
            fontVariant: ['tabular-nums'],
            lineHeight: 18,
          }}>
          {label}
        </Text>
      </View>
    </View>
  );
}
