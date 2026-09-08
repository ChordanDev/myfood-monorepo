import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface OnboardingTheme {
  appBg: string;
  colorBlack: string;
  colorDark: string;
  icon: string;
  colorMedium: string;
  colorLight: string;
  textBlack: string;
  textLight: string;
  textMedium: string;
  primaryAccent: string;
}

interface OnboardingSectionCardProps {
  children: ReactNode;
  kicker: string;
  subtitle: string;
  theme: OnboardingTheme;
  title: string;
}

export function OnboardingSectionCard({
  children,
  kicker,
  subtitle,
  theme,
  title,
}: OnboardingSectionCardProps) {
  return (
    <View
      style={{
        backgroundColor: 'rgba(160, 153, 126, 0.86)',
        borderColor: 'rgba(237, 232, 213, 0.22)',
        borderRadius: 28,
        borderWidth: 1,
        gap: 16,
        padding: 18,
      }}>
      <View style={{ gap: 6 }}>
        <Text style={[styles.kicker, { color: theme.primaryAccent }]}>{kicker.toUpperCase()}</Text>
        <Text style={[styles.title, { color: theme.textBlack }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.colorMedium }]}>{subtitle}</Text>
      </View>
      <View style={{ gap: 14 }}>{children}</View>
    </View>
  );
}

export function inputStyle(theme: OnboardingTheme) {
  return {
    backgroundColor: theme.colorBlack,
    borderColor: 'rgba(230, 148, 71, 0.18)',
    borderRadius: 24,
    borderWidth: 1,
    color: theme.textLight,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  };
}

export function FieldLabel({ theme, text }: { theme: OnboardingTheme; text: string }) {
  return <Text style={[styles.fieldLabel, { color: theme.textBlack }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  kicker: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10.5,
    lineHeight: 14,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 20,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 21,
    lineHeight: 28,
  },
});
