import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/features/auth';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { getAuthErrorMessage } from '@/services/authService';
import type {
  CookingSkill,
  HungerLevel,
  MealSlot,
  SlotCookingTime,
} from '@/features/auth/types/auth';
import type { DietCode, HardRestrictionCode } from '@/features/preferences/constants/catalog';
import { COOKING_SKILLS } from '@/features/preferences/constants/onboardingOptions';
import {
  HouseholdSection,
  MealTimesSection,
  OnboardingHero,
  PreferencesSection,
} from '@/features/preferences/components/onboarding';
import {
  OnboardingValidationError,
  buildOnboardingPayload,
  type OnboardingFormState,
} from '@/features/preferences/utils/onboardingPayload';
import { canSubmitOnboarding } from '@/features/preferences/utils/onboardingSubmitGate';
import { parseListInput } from '@/features/preferences/utils/parseListInput';
import {
  buildSlot,
  buildSlotForm,
  defaultSlot,
  type SlotFormState,
  type SlotMode,
} from '@/features/preferences/utils/onboardingSlot';

interface OnboardingScreenProps {
  previewMode?: boolean;
}

export function OnboardingScreen({ previewMode = false }: OnboardingScreenProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { theme } = useRecipeTheme();
  const { isAuthenticated, isLoading, isComplete, accessToken, completeOnboarding, user, signOut } =
    useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [householdSize, setHouseholdSize] = useState('1');
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>('beginner');
  const [diet, setDiet] = useState<DietCode | null>(null);
  const [hardRestrictions, setHardRestrictions] = useState<HardRestrictionCode[]>([]);
  const [softPreferences, setSoftPreferences] = useState('');
  const [slots, setSlots] = useState<Record<MealSlot, SlotFormState>>(() => ({
    breakfast: buildSlotForm(defaultSlot()),
    lunch: buildSlotForm(defaultSlot()),
    dinner: buildSlotForm(defaultSlot()),
  }));
  const [submitting, setSubmitting] = useState(false);

  const trimmedDisplayName = useMemo(() => displayName.trim(), [displayName]);

  const householdSizeNumber = useMemo(() => {
    const parsed = Number.parseInt(householdSize, 10);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 1 || parsed > 20) return null;
    return parsed;
  }, [householdSize]);

  const isValid = useMemo(() => {
    if (trimmedDisplayName.length < 1 || trimmedDisplayName.length > 60) return false;
    if (householdSizeNumber === null) return false;
    if (!COOKING_SKILLS.includes(cookingSkill)) return false;
    return true;
  }, [trimmedDisplayName, householdSizeNumber, cookingSkill]);

  const handleSlotModeChange = useCallback((slot: MealSlot, mode: SlotMode) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: {
        ...prev[slot],
        mode,
        // Reset dependent state so the UI stays consistent.
        customText: mode === 'custom' ? prev[slot].customText : '',
      },
    }));
  }, []);

  const handleSlotPresetChange = useCallback((slot: MealSlot, preset: number) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], mode: 'preset', preset },
    }));
  }, []);

  const handleSlotCustomChange = useCallback((slot: MealSlot, text: string) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], mode: 'custom', customText: sanitized },
    }));
  }, []);

  const handleSlotHungerChange = useCallback((slot: MealSlot, hunger: HungerLevel) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], hunger },
    }));
  }, []);

  const buildSlotPayload = useCallback(
    (slot: MealSlot): SlotCookingTime => {
      const form = slots[slot];
      if (form.mode === 'noCook') {
        return buildSlot('noCook', 0, form.hunger);
      }
      if (form.mode === 'custom') {
        const parsed = Number.parseInt(form.customText, 10);
        return buildSlot('custom', Number.isFinite(parsed) ? parsed : 0, form.hunger);
      }
      return buildSlot('preset', form.preset, form.hunger);
    },
    [slots]
  );

  const handleToggleHardRestriction = useCallback((code: HardRestrictionCode) => {
    setHardRestrictions((prev) =>
      prev.includes(code) ? prev.filter((entry) => entry !== code) : [...prev, code]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (isLoading) {
      // Defense-in-depth: AuthContext hasn't hydrated yet, so we cannot send
      // a request with a bearer token. Mirror the existing redirect logic.
      return;
    }
    if (!isValid) {
      Alert.alert('Faltan datos', 'Revisá los campos obligatorios antes de continuar.');
      return;
    }

    if (previewMode) {
      Alert.alert('Modo preview', 'El formulario se renderiza sin guardar cambios.');
      return;
    }

    const formState: OnboardingFormState = {
      displayName: trimmedDisplayName,
      householdSize: householdSizeNumber ?? 1,
      cookingSkill,
      preferences: {
        diet,
        hardRestrictions,
        softPreferences: parseListInput(softPreferences),
      },
      slotCookingTimes: {
        breakfast: buildSlotPayload('breakfast'),
        lunch: buildSlotPayload('lunch'),
        dinner: buildSlotPayload('dinner'),
      },
    };

    let payload;
    try {
      payload = buildOnboardingPayload(formState);
    } catch (error) {
      if (error instanceof OnboardingValidationError) {
        Alert.alert('Revisá el formulario', error.message);
        return;
      }
      throw error;
    }

    setSubmitting(true);
    try {
      await completeOnboarding(payload);
      // AuthContext completes the POST and then runs a background refreshMe();
      // the index gate reroutes based on the freshly-loaded /me snapshot.
      router.replace('/');
    } catch (error) {
      Alert.alert('No pudimos guardar', getAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [
    buildSlotPayload,
    completeOnboarding,
    cookingSkill,
    diet,
    hardRestrictions,
    householdSizeNumber,
    isLoading,
    isValid,
    previewMode,
    router,
    softPreferences,
    submitting,
    trimmedDisplayName,
  ]);

  if (!previewMode && !isLoading && !isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!previewMode && !isLoading && isComplete) {
    return <Redirect href="/" />;
  }

  // Block submit until we have a token. The POST /api/onboarding/complete
  // requires Authorization: Bearer ... and the gate flips only when /me
  // reports isComplete=true. Sending before hydration would either fail
  // with 401 or leave the user wedged on this screen. The rule is
  // unit-tested in `onboardingSubmitGate.test.ts`.
  const submitDisabled = !canSubmitOnboarding({
    isLoading,
    isSubmitting: submitting,
    hasAccessToken: previewMode || accessToken !== null,
    isValid,
  });

  const isCompact = width < 380;

  return (
    <LinearGradient
      colors={[theme.appBg, '#D4CCAE', theme.appBg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.28} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10, 13, 7, 0.38)', 'rgba(10, 13, 7, 0)', 'rgba(10, 13, 7, 0.16)']}
        locations={[0, 0.22, 1]}
        style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }}
      />
      <SafeAreaContent overflowHidden={false}>
        <ScrollView
          testID="e2e-onboarding-screen"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 32, gap: 18, paddingHorizontal: 12 }}
          keyboardShouldPersistTaps="handled">
          <OnboardingHero isCompact={isCompact} theme={theme} />

          <HouseholdSection
            cookingSkill={cookingSkill}
            displayName={displayName}
            householdSize={householdSize}
            householdSizeNumber={householdSizeNumber}
            onCookingSkillChange={setCookingSkill}
            onDisplayNameChange={setDisplayName}
            onHouseholdSizeChange={setHouseholdSize}
            theme={theme}
          />

          <PreferencesSection
            diet={diet}
            hardRestrictions={hardRestrictions}
            onDietChange={setDiet}
            onSoftPreferencesChange={setSoftPreferences}
            onToggleHardRestriction={handleToggleHardRestriction}
            softPreferences={softPreferences}
            theme={theme}
          />

          <MealTimesSection
            onSlotCustomChange={handleSlotCustomChange}
            onSlotHungerChange={handleSlotHungerChange}
            onSlotModeChange={handleSlotModeChange}
            onSlotPresetChange={handleSlotPresetChange}
            slots={slots}
            theme={theme}
          />

          <View style={{ gap: 12, paddingHorizontal: 2 }}>
            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              disabled={submitDisabled}
              style={({ pressed }) => [
                styles.submitButton,
                {
                  backgroundColor: submitDisabled ? 'rgba(69, 64, 47, 0.58)' : theme.colorBlack,
                  borderColor: submitDisabled ? 'transparent' : theme.primaryAccent,
                  opacity: submitDisabled ? 0.6 : pressed ? 0.9 : 1,
                },
              ]}>
              {submitting ? (
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              ) : (
                <Text style={[styles.submitLabel, { color: theme.textLight }]}>
                  Guardar preferencias
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={previewMode ? undefined : signOut}
              style={({ pressed }) => [styles.signOutButton, { opacity: pressed ? 0.8 : 1 }]}>
              <Text style={[styles.signOutLabel, { color: theme.colorMedium }]}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaContent>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  signOutButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 10.5,
  },
  signOutLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 32,
    borderWidth: 3,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  submitLabel: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    letterSpacing: 0.2,
    lineHeight: 21,
  },
});
