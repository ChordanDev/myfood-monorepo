import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAuth } from '@/features/auth';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { MEAL_SLOTS, SLOT_LABELS } from '@/features/preferences/constants/onboardingOptions';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { getTitleMetrics } from '@/utils/responsive';
import { AccountCard, LoadErrorNotice, SettingsGroup, SettingsRow } from '../components';
import {
  LOADING_VALUE_LABEL,
  PREFERENCE_FIELD_LABELS,
  PROFILE_FIELD_LABELS,
  UNAVAILABLE_VALUE_LABEL,
} from '../constants/settingsLabels';
import { useSettingsState } from '../hooks/useSettingsState';
import {
  formatCookingSkillSummary,
  formatDietSummary,
  formatDisplayNameSummary,
  formatHardRestrictionsSummary,
  formatHouseholdSummary,
  formatPlanSummary,
  formatSlotSummary,
  formatSoftPreferencesSummary,
  formatTrialPill,
  getInitials,
  getTrialState,
} from '../utils/settingsFormatters';

const CONTENT_BOTTOM_SPACING = 24;

export function SettingsScreen() {
  const { theme } = useRecipeTheme();
  const { isLoading, isAuthenticated, isComplete, canUseApp } = useAuth();
  const { me, now, preferences, slotTimes, loadStatus, retryLoad, signOut } = useSettingsState();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const backgroundColors: [string, string] = [theme.colorDark, theme.appBg];
  const {
    currentColors: currentBackgroundColors,
    previousColors: previousBackgroundColors,
    animatedStyle: animatedBackgroundStyle,
    AnimatedView,
  } = useGradientCrossfade(backgroundColors);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !isComplete || !canUseApp || !me) {
    return <Redirect href="/" />;
  }

  const { user, account } = me;
  const displayName = user.displayName?.trim() || null;
  const pendingLabel = loadStatus === 'error' ? UNAVAILABLE_VALUE_LABEL : LOADING_VALUE_LABEL;

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <LinearGradient
        colors={previousBackgroundColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[0, 0.1]}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedView style={[StyleSheet.absoluteFill, animatedBackgroundStyle]}>
        <LinearGradient
          colors={currentBackgroundColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          locations={[0, 0.1]}
          style={styles.gradient}
        />
      </AnimatedView>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false}>
        <TitlePrimary text="AJUSTES" metrics={getTitleMetrics(width, height)} />
        <ScrollView
          // The safe area is already applied: on top by SafeAreaContent, at the bottom by the
          // tab bar clearance. Letting iOS add its own inset would count it twice.
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CONTENT_BOTTOM_SPACING,
            },
          ]}
          showsVerticalScrollIndicator={false}>
          <AccountCard
            initials={getInitials(displayName, user.email)}
            primaryLine={displayName ?? user.email}
            secondaryLine={displayName ? user.email : null}
            trialLabel={formatTrialPill(getTrialState(account, now))}
          />

          <SettingsGroup title="Tu hogar" testID="settings-group-household">
            <SettingsRow
              testID="settings-row-display-name"
              label={PROFILE_FIELD_LABELS.displayName}
              value={formatDisplayNameSummary(user.displayName)}
            />
            <SettingsRow
              testID="settings-row-household-size"
              label={PROFILE_FIELD_LABELS.householdSize}
              value={formatHouseholdSummary(user.householdSize)}
            />
            <SettingsRow
              testID="settings-row-cooking-skill"
              label={PROFILE_FIELD_LABELS.cookingSkill}
              value={formatCookingSkillSummary(user.cookingSkill)}
            />
          </SettingsGroup>

          {loadStatus === 'error' ? <LoadErrorNotice onRetry={retryLoad} /> : null}

          <SettingsGroup title="Preferencias" testID="settings-group-preferences">
            <SettingsRow
              testID="settings-row-diet"
              label={PREFERENCE_FIELD_LABELS.diet}
              value={preferences ? formatDietSummary(preferences.diet) : pendingLabel}
            />
            <SettingsRow
              testID="settings-row-hard-restrictions"
              label={PREFERENCE_FIELD_LABELS.hardRestrictions}
              value={
                preferences
                  ? formatHardRestrictionsSummary(preferences.hardRestrictions)
                  : pendingLabel
              }
            />
            <SettingsRow
              testID="settings-row-soft-preferences"
              label={PREFERENCE_FIELD_LABELS.softPreferences}
              value={
                preferences
                  ? formatSoftPreferencesSummary(preferences.softPreferences)
                  : pendingLabel
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Tiempos por comida" testID="settings-group-slot-times">
            {MEAL_SLOTS.map((slot) => (
              <SettingsRow
                key={slot}
                testID={`settings-row-slot-${slot}`}
                label={SLOT_LABELS[slot]}
                value={slotTimes ? formatSlotSummary(slotTimes[slot]) : pendingLabel}
              />
            ))}
          </SettingsGroup>

          <SettingsGroup title="Cuenta" testID="settings-group-account">
            <SettingsRow
              testID="settings-row-plan"
              label="Plan"
              value={formatPlanSummary(account, now)}
            />
            <SettingsRow
              testID="settings-row-sign-out"
              label="Cerrar sesión"
              tone="alert"
              hideChevron
              onPress={signOut}
            />
          </SettingsGroup>
        </ScrollView>
      </SafeAreaContent>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingHorizontal: 14,
  },
  gradient: { flex: 1 },
  screen: { flex: 1 },
});
