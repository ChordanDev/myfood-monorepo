import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { MEAL_SLOT_LABEL } from '@/constants/mealSlots';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAuth } from '@/features/auth';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { COOKING_TIME_SLOTS } from '@/features/preferences/constants/preferenceOptions';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { getTitleMetrics } from '@/utils/responsive';
import {
  AccountCard,
  LoadErrorNotice,
  SettingsEditor,
  SettingsGroup,
  SettingsRow,
  SettingsSheet,
} from '../components';
import { SETTINGS_TITLE_FONT_SIZE } from '../constants/layout';
import {
  BUDGET_LABEL,
  BUDGET_LOAD_ERROR_MESSAGE,
  LOADING_VALUE_LABEL,
  PREFERENCES_LOAD_ERROR_MESSAGE,
  PREFERENCE_FIELD_LABELS,
  PROFILE_FIELD_LABELS,
  UNAVAILABLE_VALUE_LABEL,
} from '../constants/settingsLabels';
import { useSettingsState } from '../hooks/useSettingsState';
import { getSettingsDraftTitle } from '../utils/settingsDraft';
import {
  formatBudgetSummary,
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
  const router = useRouter();
  const { isLoading, isAuthenticated, isComplete, canUseApp } = useAuth();
  const {
    me,
    now,
    preferences,
    slotTimes,
    budget,
    budgetStatus,
    canEditBudget,
    loadStatus,
    retryLoad,
    retryBudget,
    signOut,
    sheet,
    isSaving,
    openEditor,
    closeEditor,
    changeDraft,
    saveEditor,
  } = useSettingsState();
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
  // Rows over data that is not loaded stay closed: an edit would save over it.
  const canEditLoadedData = loadStatus === 'ready';

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
        <TitlePrimary
          text="AJUSTES"
          metrics={{ ...getTitleMetrics(width, height), titleFontSize: SETTINGS_TITLE_FONT_SIZE }}
        />
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
              onPress={() => openEditor({ kind: 'profile', field: 'displayName' })}
            />
            <SettingsRow
              testID="settings-row-household-size"
              label={PROFILE_FIELD_LABELS.householdSize}
              value={formatHouseholdSummary(user.householdSize)}
              onPress={() => openEditor({ kind: 'profile', field: 'householdSize' })}
            />
            <SettingsRow
              testID="settings-row-cooking-skill"
              label={PROFILE_FIELD_LABELS.cookingSkill}
              value={formatCookingSkillSummary(user.cookingSkill)}
              onPress={() => openEditor({ kind: 'profile', field: 'cookingSkill' })}
            />
          </SettingsGroup>

          {loadStatus === 'error' ? (
            <LoadErrorNotice
              message={PREFERENCES_LOAD_ERROR_MESSAGE}
              onRetry={retryLoad}
              testID="settings-load-retry"
            />
          ) : null}

          <SettingsGroup title="Preferencias" testID="settings-group-preferences">
            <SettingsRow
              testID="settings-row-diet"
              label={PREFERENCE_FIELD_LABELS.diet}
              value={preferences ? formatDietSummary(preferences.diet) : pendingLabel}
              disabled={!canEditLoadedData}
              onPress={() => openEditor({ kind: 'diet' })}
            />
            <SettingsRow
              testID="settings-row-hard-restrictions"
              label={PREFERENCE_FIELD_LABELS.hardRestrictions}
              value={
                preferences
                  ? formatHardRestrictionsSummary(preferences.hardRestrictions)
                  : pendingLabel
              }
              disabled={!canEditLoadedData}
              onPress={() => openEditor({ kind: 'hardRestrictions' })}
            />
            <SettingsRow
              testID="settings-row-soft-preferences"
              label={PREFERENCE_FIELD_LABELS.softPreferences}
              value={
                preferences
                  ? formatSoftPreferencesSummary(preferences.softPreferences)
                  : pendingLabel
              }
              disabled={!canEditLoadedData}
              onPress={() => openEditor({ kind: 'softPreferences' })}
            />
          </SettingsGroup>

          <SettingsGroup title="Tiempos por comida" testID="settings-group-slot-times">
            {COOKING_TIME_SLOTS.map((slot) => (
              <SettingsRow
                key={slot}
                testID={`settings-row-slot-${slot}`}
                label={MEAL_SLOT_LABEL[slot]}
                value={slotTimes ? formatSlotSummary(slotTimes[slot]) : pendingLabel}
                disabled={!canEditLoadedData}
                onPress={() => openEditor({ kind: 'slot', slot })}
              />
            ))}
          </SettingsGroup>

          {/* The preferences retry above also reloads the Budget, so it gets no second notice. */}
          {budgetStatus === 'error' && loadStatus !== 'error' ? (
            <LoadErrorNotice
              message={BUDGET_LOAD_ERROR_MESSAGE}
              onRetry={retryBudget}
              testID="settings-budget-retry"
            />
          ) : null}

          <SettingsGroup title="Cuenta" testID="settings-group-account">
            <SettingsRow
              testID="settings-row-favorites"
              label="Favoritos"
              onPress={() => router.push('/favorites')}
            />
            <SettingsRow
              testID="settings-row-budget"
              label={BUDGET_LABEL}
              value={
                budget
                  ? formatBudgetSummary(budget)
                  : budgetStatus === 'error'
                    ? UNAVAILABLE_VALUE_LABEL
                    : LOADING_VALUE_LABEL
              }
              // A member who is not the owner reads it without a way to edit it.
              onPress={
                me.membership.role === 'owner' ? () => openEditor({ kind: 'budget' }) : undefined
              }
              disabled={!canEditBudget}
            />
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
      {sheet ? (
        <SettingsSheet
          visible={sheet.visible}
          title={getSettingsDraftTitle(sheet.draft)}
          saving={isSaving}
          errorMessage={sheet.errorMessage}
          onSave={saveEditor}
          onClose={closeEditor}>
          <SettingsEditor
            draft={sheet.draft}
            fieldError={sheet.fieldError}
            onChange={changeDraft}
          />
        </SettingsSheet>
      ) : null}
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
