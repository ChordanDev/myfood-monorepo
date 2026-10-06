import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';

interface AccountCardProps {
  initials: string;
  primaryLine: string;
  /** Hidden when null, e.g. when the email is already the primary line. */
  secondaryLine: string | null;
  /** Hidden when null: the account is not in trial. */
  trialLabel: string | null;
}

export function AccountCard({
  initials,
  primaryLine,
  secondaryLine,
  trialLabel,
}: AccountCardProps) {
  const { theme } = useRecipeTheme();
  const surfaceStyle = useAnimatedThemeStyle({ backgroundColor: theme.colorDark });

  return (
    <ShadowSurface style={styles.shadowSurface}>
      <Animated.View testID="settings-account-card" style={[styles.surface, surfaceStyle]}>
        <View
          testID="settings-account-avatar"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.avatar,
            {
              backgroundColor: withOpacity(theme.icon, 0.15),
              borderColor: withOpacity(theme.icon, 0.3),
            },
          ]}>
          <Text style={[styles.initials, { color: theme.primaryAccent }]}>{initials}</Text>
        </View>

        <View style={styles.identity}>
          <Text numberOfLines={1} style={[styles.primaryLine, { color: theme.textLight }]}>
            {primaryLine}
          </Text>
          {secondaryLine ? (
            <Text
              selectable
              numberOfLines={1}
              style={[styles.secondaryLine, { color: theme.textMedium }]}>
              {secondaryLine}
            </Text>
          ) : null}
        </View>

        {trialLabel ? (
          <View
            testID="settings-account-trial-pill"
            style={[
              styles.trialPill,
              {
                backgroundColor: withOpacity(theme.primaryAccent, 0.15),
                borderColor: withOpacity(theme.primaryAccent, 0.3),
              },
            ]}>
            <Text style={[styles.trialLabel, { color: theme.primaryAccent }]}>{trialLabel}</Text>
          </View>
        ) : null}
      </Animated.View>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  initials: {
    fontFamily: 'MontserratAlternates_900Black',
    fontSize: 19,
    letterSpacing: 1,
  },
  primaryLine: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 17,
    letterSpacing: 0.5,
    lineHeight: 22,
  },
  secondaryLine: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  shadowSurface: {
    borderRadius: 24,
  },
  surface: {
    alignItems: 'center',
    borderRadius: 24,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  trialLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  trialPill: {
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
