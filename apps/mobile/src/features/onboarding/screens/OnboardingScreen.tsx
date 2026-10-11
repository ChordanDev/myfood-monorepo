import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/features/auth';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { getAuthErrorMessage } from '@/services/authService';
import type { CookingSkill, CookingTimeSlot, HungerLevel } from '@/features/auth/types/auth';
import type { DietCode, HardRestrictionCode } from '@/features/preferences/constants/catalog';
import {
  HouseholdStep,
  MealTimesStep,
  OnboardingFooter,
  OnboardingProgress,
  OnboardingStepHeading,
  PreferencesStep,
} from '@/features/onboarding/components';
import {
  OnboardingValidationError,
  buildOnboardingPayload,
  type OnboardingFormState,
} from '@/features/onboarding/utils/onboardingPayload';
import { canSubmitOnboarding } from '@/features/onboarding/utils/onboardingSubmitGate';
import { parseListInput } from '@/features/preferences/utils/parseListInput';
import { defaultSlot } from '@/features/preferences/utils/slotCookingTime';
import {
  buildSlotForm,
  slotFormToCookingTime,
  type SlotFormState,
  type SlotMode,
} from '@/features/onboarding/utils/onboardingSlot';
import {
  ONBOARDING_STEPS,
  getNextStep,
  getPreviousStep,
  getStepNumber,
  validateOnboardingStep,
  type OnboardingDraft,
  type OnboardingStep,
} from '@/features/onboarding/utils/onboardingSteps';

const STEP_COPY: Record<OnboardingStep, { title: string; subtitle: string }> = {
  household: {
    title: 'Tu hogar',
    subtitle: 'Primero lo importante. La IA necesita contexto humano antes de sugerir recetas.',
  },
  preferences: {
    title: 'Preferencias',
    subtitle:
      'Separá restricciones reales de preferencias blandas. Esa diferencia es clave para no sugerir mal.',
  },
  mealTimes: {
    title: 'Tiempos por comida',
    subtitle:
      'Elegí tiempo y hambre por comida. Mejor una respuesta honesta que un plan imposible.',
  },
};

export function OnboardingScreen() {
  const router = useRouter();
  const { theme } = useRecipeTheme();
  const { isAuthenticated, isLoading, isComplete, accessToken, completeOnboarding, user, signOut } =
    useAuth();

  const [step, setStep] = useState<OnboardingStep>(ONBOARDING_STEPS[0]);
  // Why the last attempt to leave the step failed. Shown above the primary
  // button until the user edits the step.
  const [stepError, setStepError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [householdSize, setHouseholdSize] = useState(1);
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>('beginner');
  const [diet, setDiet] = useState<DietCode | null>(null);
  const [hardRestrictions, setHardRestrictions] = useState<HardRestrictionCode[]>([]);
  const [softPreferences, setSoftPreferences] = useState('');
  const [slots, setSlots] = useState<Record<CookingTimeSlot, SlotFormState>>(() => ({
    breakfast: buildSlotForm(defaultSlot()),
    lunch: buildSlotForm(defaultSlot()),
    dinner: buildSlotForm(defaultSlot()),
  }));
  const [submitting, setSubmitting] = useState(false);

  const draft = useMemo<OnboardingDraft>(
    () => ({
      displayName,
      householdSize,
      cookingSkill,
      diet,
      hardRestrictions,
      softPreferences,
      slots,
    }),
    [cookingSkill, diet, displayName, hardRestrictions, householdSize, slots, softPreferences]
  );

  const isValid = useMemo(
    () => ONBOARDING_STEPS.every((entry) => validateOnboardingStep(entry, draft) === null),
    [draft]
  );

  const previousStep = getPreviousStep(step);

  const handleBack = useCallback(() => {
    if (previousStep === null) return;
    setStepError(null);
    setStep(previousStep);
  }, [previousStep]);

  // Android hardware back walks the wizard backwards. On the first step the
  // listener is not registered, so the system keeps its default behavior.
  useEffect(() => {
    if (previousStep === null) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // A request in flight still belongs to the last step.
      if (!submitting) handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack, previousStep, submitting]);

  // Wraps a change handler so that any edit dismisses the message left by a
  // failed attempt to leave the step.
  function editing<Args extends unknown[]>(apply: (...args: Args) => void) {
    return (...args: Args) => {
      setStepError(null);
      apply(...args);
    };
  }

  const handleSlotModeChange = useCallback((slot: CookingTimeSlot, mode: SlotMode) => {
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

  const handleSlotPresetChange = useCallback((slot: CookingTimeSlot, preset: number) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], mode: 'preset', preset },
    }));
  }, []);

  const handleSlotCustomChange = useCallback((slot: CookingTimeSlot, text: string) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], mode: 'custom', customText: sanitized },
    }));
  }, []);

  const handleSlotHungerChange = useCallback((slot: CookingTimeSlot, hunger: HungerLevel) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], hunger },
    }));
  }, []);

  const handleToggleHardRestriction = useCallback((code: HardRestrictionCode) => {
    setHardRestrictions((prev) =>
      prev.includes(code) ? prev.filter((entry) => entry !== code) : [...prev, code]
    );
  }, []);

  const hasAccessToken = accessToken !== null;

  const handleSubmit = useCallback(async () => {
    // Block submit until we have a token. The POST /api/onboarding/complete
    // requires Authorization: Bearer ... and the gate flips only when /me
    // reports isComplete=true. Sending before hydration would either fail
    // with 401 or leave the user wedged on this screen. The rule is
    // unit-tested in `onboardingSubmitGate.test.ts`.
    if (!canSubmitOnboarding({ isLoading, isSubmitting: submitting, hasAccessToken, isValid })) {
      return;
    }

    const formState: OnboardingFormState = {
      displayName: displayName.trim(),
      householdSize,
      cookingSkill,
      preferences: {
        diet,
        hardRestrictions,
        softPreferences: parseListInput(softPreferences),
      },
      slotCookingTimes: {
        breakfast: slotFormToCookingTime(slots.breakfast),
        lunch: slotFormToCookingTime(slots.lunch),
        dinner: slotFormToCookingTime(slots.dinner),
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
    completeOnboarding,
    cookingSkill,
    diet,
    displayName,
    hardRestrictions,
    hasAccessToken,
    householdSize,
    isLoading,
    isValid,
    router,
    slots,
    softPreferences,
    submitting,
  ]);

  // The primary button: validates the step on screen, then moves on or, on
  // the last step, submits.
  const handlePrimaryPress = useCallback(async () => {
    if (submitting) return;

    const problem = validateOnboardingStep(step, draft);
    if (problem !== null) {
      setStepError(problem);
      return;
    }
    setStepError(null);

    const nextStep = getNextStep(step);
    if (nextStep !== null) {
      setStep(nextStep);
      return;
    }
    await handleSubmit();
  }, [draft, handleSubmit, step, submitting]);

  if (!isLoading && !isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!isLoading && isComplete) {
    return <Redirect href="/" />;
  }

  const isLastStep = getNextStep(step) === null;
  // The button stays pressable with invalid data so the press can explain
  // what is missing. On the last step it also waits for the session, since
  // that press sends the request.
  const primaryDisabled =
    submitting ||
    (isLastStep &&
      !canSubmitOnboarding({ isLoading, isSubmitting: submitting, hasAccessToken, isValid: true }));

  return (
    <View style={{ backgroundColor: theme.appBg, flex: 1 }}>
      {/* Same ground as Home: a dark fade at the top of the screen ground, under the noise. */}
      <LinearGradient
        pointerEvents="none"
        colors={[theme.colorDark, theme.appBg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[0, 0.1]}
        style={StyleSheet.absoluteFill}
      />
      <NoisyBackground opacity={0.3} />
      {/* SafeAreaContent pads both insets, so the scroll view must not adjust for them again. */}
      <SafeAreaContent overflowHidden={false}>
        <View style={{ paddingHorizontal: 14, paddingTop: 1 }}>
          <OnboardingProgress
            currentStep={getStepNumber(step)}
            onBack={previousStep === null ? undefined : handleBack}
            theme={theme}
            totalSteps={ONBOARDING_STEPS.length}
          />
        </View>

        <ScrollView
          // Remounting per step starts every step at the top.
          key={step}
          testID="e2e-onboarding-screen"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            gap: 26,
            paddingBottom: 24,
            paddingHorizontal: 14,
            paddingTop: 15,
          }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}>
          <OnboardingStepHeading
            subtitle={STEP_COPY[step].subtitle}
            theme={theme}
            title={STEP_COPY[step].title}
          />

          {step === 'household' ? (
            <HouseholdStep
              cookingSkill={cookingSkill}
              displayName={displayName}
              householdSize={householdSize}
              onCookingSkillChange={editing(setCookingSkill)}
              onDisplayNameChange={editing(setDisplayName)}
              onHouseholdSizeChange={editing(setHouseholdSize)}
              theme={theme}
            />
          ) : null}

          {step === 'preferences' ? (
            <PreferencesStep
              diet={diet}
              hardRestrictions={hardRestrictions}
              onDietChange={editing(setDiet)}
              onSoftPreferencesChange={editing(setSoftPreferences)}
              onToggleHardRestriction={editing(handleToggleHardRestriction)}
              softPreferences={softPreferences}
              theme={theme}
            />
          ) : null}

          {step === 'mealTimes' ? (
            <MealTimesStep
              onSlotCustomChange={editing(handleSlotCustomChange)}
              onSlotHungerChange={editing(handleSlotHungerChange)}
              onSlotModeChange={editing(handleSlotModeChange)}
              onSlotPresetChange={editing(handleSlotPresetChange)}
              slots={slots}
              theme={theme}
            />
          ) : null}
        </ScrollView>

        <OnboardingFooter
          errorMessage={stepError}
          isLastStep={isLastStep}
          isSubmitting={submitting}
          onPrimaryPress={handlePrimaryPress}
          onSignOut={signOut}
          primaryDisabled={primaryDisabled}
          theme={theme}
        />
      </SafeAreaContent>
    </View>
  );
}
