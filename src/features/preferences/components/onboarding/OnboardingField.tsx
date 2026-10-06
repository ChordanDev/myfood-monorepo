import { type ReactNode } from 'react';
import { Pressable, Text, View, type ViewProps } from 'react-native';
import { ShadowSurface } from '@/components';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';

interface OnboardingFieldProps {
  children: ReactNode;
  label: string;
  theme: RecipeThemeConfig;
  /** Set to `radiogroup` when the field holds a set of single-choice chips. */
  accessibilityRole?: ViewProps['accessibilityRole'];
  /** Makes the whole card a touch target, e.g. to focus the input it holds. */
  onPress?: () => void;
}

const contentStyle = { gap: 8, paddingHorizontal: 16, paddingVertical: 14 } as const;

// One question of the wizard: a light card on the screen ground with an
// uppercase label and its control underneath.
export function OnboardingField({
  accessibilityRole,
  children,
  label,
  onPress,
  theme,
}: OnboardingFieldProps) {
  return (
    <ShadowSurface
      accessibilityLabel={accessibilityRole ? label : undefined}
      accessibilityRole={accessibilityRole}
      style={{
        backgroundColor: theme.colorLight,
        borderCurve: 'continuous',
        borderRadius: 21,
      }}>
      {onPress ? (
        // The control inside stays the accessible element; the card only
        // widens its touch area.
        <Pressable accessible={false} onPress={onPress} style={contentStyle}>
          <OnboardingFieldLabel text={label} theme={theme} />
          {children}
        </Pressable>
      ) : (
        <View style={contentStyle}>
          <OnboardingFieldLabel text={label} theme={theme} />
          {children}
        </View>
      )}
    </ShadowSurface>
  );
}

export function OnboardingFieldLabel({ text, theme }: { text: string; theme: RecipeThemeConfig }) {
  return (
    <Text
      style={{
        color: withOpacity(theme.textDark, 0.6),
        fontFamily: 'Inter_700Bold',
        fontSize: 13,
        letterSpacing: 0.4,
        lineHeight: 18,
        textTransform: 'uppercase',
      }}>
      {text}
    </Text>
  );
}
