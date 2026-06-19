import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

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
        <Text className="font-inter-bold text-xs" style={{ color: theme.primaryAccent }}>
          {kicker.toUpperCase()}
        </Text>
        <Text className="font-montserrat-bold text-2xl" style={{ color: theme.textBlack }}>
          {title}
        </Text>
        <Text
          className="font-inter-medium text-sm"
          style={{ color: theme.colorMedium, lineHeight: 20 }}>
          {subtitle}
        </Text>
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
  return (
    <Text className="font-inter-bold text-sm" style={{ color: theme.textBlack }}>
      {text}
    </Text>
  );
}
