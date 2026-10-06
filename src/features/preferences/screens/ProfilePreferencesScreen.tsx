import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/features/auth';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { getAuthErrorMessage } from '@/services/authService';
import type {
  HungerLevel,
  MealSlot,
  SlotCookingTime,
  UserPreferences,
} from '@/features/auth/types/auth';
import {
  DIET_CODES,
  DIET_LABELS,
  HARD_RESTRICTION_CODES,
  HARD_RESTRICTION_LABELS,
  type DietCode,
  type HardRestrictionCode,
} from '@/features/preferences/constants/catalog';
import {
  PreferencesValidationError,
  buildPreferencesPayload,
} from '@/features/preferences/utils/preferencesPayload';
import {
  canSave,
  initialLoadState,
  loadFailed,
  loadSucceeded,
  saveFinished,
  startLoading,
  startSaving,
  type LoadState,
} from '@/features/preferences/utils/profileLoadState';
import { parseListInput } from '@/features/preferences/utils/parseListInput';
import { runSequentialProfileSave } from '@/features/preferences/utils/sequentialProfileSave';

const HUNGER_LEVELS: readonly HungerLevel[] = ['light', 'normal', 'strong'];
const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

interface ThemeLike {
  icon: string;
  colorMedium: string;
  textBlack: string;
  textLight: string;
  primaryAccent: string;
}

const DEFAULT_SLOT: SlotCookingTime = { cookingTimeMinutes: 0, hungerLevel: 'normal' };

export function ProfilePreferencesScreen() {
  const { theme } = useRecipeTheme();
  const {
    isAuthenticated,
    isLoading,
    isComplete,
    canUseApp,
    me,
    user,
    signOut,
    fetchUserPreferences,
    saveUserPreferences,
    fetchSlotCookingTimes,
    saveSlotCookingTimes,
  } = useAuth();

  const [diet, setDiet] = useState<DietCode | null>(null);
  const [hardRestrictions, setHardRestrictions] = useState<HardRestrictionCode[]>([]);
  const [softPreferences, setSoftPreferences] = useState('');
  const [slots, setSlots] = useState<Record<MealSlot, SlotCookingTime>>({
    breakfast: DEFAULT_SLOT,
    lunch: DEFAULT_SLOT,
    dinner: DEFAULT_SLOT,
  });
  const [loadState, setLoadState] = useState<LoadState>(initialLoadState);

  // Hydrate local form state from a successful server response. Wrapped in
  // a function so the catalog code validation has one well-known place to
  // run. If the backend ever drifts from the catalog, we keep the local
  // form empty for that field rather than rendering an unselectable value.
  const hydrateFromServer = useCallback(
    (prefs: UserPreferences, slotTimes: Record<MealSlot, SlotCookingTime>) => {
      if (prefs.diet === null) {
        setDiet(null);
      } else if ((DIET_CODES as readonly string[]).includes(prefs.diet)) {
        setDiet(prefs.diet as DietCode);
      } else {
        // Unknown diet code from the server: surface the chip group as
        // "no selection" rather than silently rendering a stale value.
        setDiet(null);
      }

      const validatedRestrictions = prefs.hardRestrictions.filter(
        (code): code is HardRestrictionCode =>
          (HARD_RESTRICTION_CODES as readonly string[]).includes(code)
      );
      setHardRestrictions(validatedRestrictions);

      setSoftPreferences(prefs.softPreferences.join(', '));
      setSlots({
        breakfast: slotTimes.breakfast ?? DEFAULT_SLOT,
        lunch: slotTimes.lunch ?? DEFAULT_SLOT,
        dinner: slotTimes.dinner ?? DEFAULT_SLOT,
      });
    },
    []
  );

  const loadData = useCallback(async () => {
    setLoadState((prev) => startLoading(prev));
    try {
      const [prefs, slotTimes] = await Promise.all([
        fetchUserPreferences(),
        fetchSlotCookingTimes(),
      ]);
      hydrateFromServer(prefs, slotTimes);
      setLoadState((prev) => loadSucceeded(prev));
    } catch (error) {
      // Distinct from "empty": the user must NOT be allowed to save here,
      // otherwise a follow-up PUT would overwrite the server row with the
      // current local defaults (all zeros). See Judgment Day S2.
      console.warn('[ProfileRoute] Failed to load preferences/slots:', error);
      setLoadState((prev) => loadFailed(prev, error));
    }
  }, [fetchSlotCookingTimes, fetchUserPreferences, hydrateFromServer]);

  useEffect(() => {
    if (isAuthenticated && isComplete && canUseApp && loadState.status === 'idle') {
      loadData();
    }
  }, [canUseApp, isAuthenticated, isComplete, loadData, loadState.status]);

  const handleSlotMinutesChange = useCallback((slot: MealSlot, text: string) => {
    const sanitized = text.replace(/[^0-9]/g, '');
    const value = sanitized.length === 0 ? 0 : Math.max(0, Number.parseInt(sanitized, 10));
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], cookingTimeMinutes: value },
    }));
  }, []);

  const handleSlotHungerChange = useCallback((slot: MealSlot, hunger: HungerLevel) => {
    setSlots((prev) => ({
      ...prev,
      [slot]: { ...prev[slot], hungerLevel: hunger },
    }));
  }, []);

  const handleToggleHardRestriction = useCallback((code: HardRestrictionCode) => {
    setHardRestrictions((prev) =>
      prev.includes(code) ? prev.filter((entry) => entry !== code) : [...prev, code]
    );
  }, []);

  const buildPayload = useCallback(() => {
    return buildPreferencesPayload({
      diet,
      hardRestrictions,
      softPreferences: parseListInput(softPreferences),
    });
  }, [diet, hardRestrictions, softPreferences]);

  const handleSave = useCallback(async () => {
    if (!canSave(loadState)) return;

    let payload;
    try {
      payload = buildPayload();
    } catch (error) {
      if (error instanceof PreferencesValidationError) {
        Alert.alert('Revisá el formulario', error.message);
        return;
      }
      throw error;
    }

    setLoadState((prev) => startSaving(prev));
    // Sequential: save preferences first, then slots. If the second call
    // fails, the first has already persisted — we surface the error and let
    // the user retry without re-applying the first PUT. This is the
    // best-effort atomicity compromise the S3 review flagged. The pure
    // helper is unit-tested in `sequentialProfileSave.test.ts`.
    const result = await runSequentialProfileSave({
      savePreferences: () => saveUserPreferences(payload),
      saveSlots: () => saveSlotCookingTimes(slots),
    });

    if (result.step === 'done') {
      const updatedPrefs = result.updatedPreferences as UserPreferences;
      const updatedSlots = result.updatedSlots as Record<MealSlot, SlotCookingTime>;
      setDiet(
        updatedPrefs.diet !== null && (DIET_CODES as readonly string[]).includes(updatedPrefs.diet)
          ? (updatedPrefs.diet as DietCode)
          : null
      );
      setHardRestrictions(
        updatedPrefs.hardRestrictions.filter((code): code is HardRestrictionCode =>
          (HARD_RESTRICTION_CODES as readonly string[]).includes(code)
        )
      );
      setSoftPreferences(updatedPrefs.softPreferences.join(', '));
      setSlots({
        breakfast: updatedSlots.breakfast ?? DEFAULT_SLOT,
        lunch: updatedSlots.lunch ?? DEFAULT_SLOT,
        dinner: updatedSlots.dinner ?? DEFAULT_SLOT,
      });
      setLoadState((prev) => saveFinished(prev));
      Alert.alert('Listo', 'Tus cambios se guardaron.');
      return;
    }

    setLoadState((prev) => saveFinished(prev, result.error));
    const errorMessage =
      result.step === 'slots'
        ? 'Guardamos tus preferencias, pero no pudimos guardar los tiempos de cocina. Reintentá.'
        : getAuthErrorMessage(result.error);
    Alert.alert('No pudimos guardar', errorMessage);
  }, [buildPayload, loadState, saveSlotCookingTimes, saveUserPreferences, slots]);

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated || !isComplete || !canUseApp) {
    return <Redirect href="/" />;
  }

  const typedTheme = theme as unknown as ThemeLike;

  return (
    <LinearGradient
      colors={[theme.colorBlack, theme.colorDark, theme.colorMedium]}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 40, gap: 24 }}
          keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={[styles.screenTitle, { color: theme.textBlack }]}>Tu perfil</Text>
            {user ? (
              <Text selectable style={[styles.headerDetail, { color: theme.primaryAccent }]}>
                {user.email}
              </Text>
            ) : null}
            {me?.user.displayName ? (
              <Text style={[styles.headerName, { color: theme.textLight }]}>
                Nombre: {me.user.displayName}
              </Text>
            ) : null}
          </View>

          {loadState.status === 'loading' ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={theme.primaryAccent} />
            </View>
          ) : null}

          {loadState.status === 'error' ? (
            <View style={[styles.section, { gap: 12 }]}>
              <Text style={[styles.errorText, { color: theme.primaryAccent }]}>
                No pudimos cargar tus datos. Reintentá antes de guardar para no sobrescribir el
                servidor.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={loadData}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { backgroundColor: theme.icon, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.mediumLabel, { color: theme.textBlack }]}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}

          {loadState.status === 'ready' ? (
            <>
              <View style={[styles.section, { gap: 16 }]}>
                <Text style={[styles.sectionTitle, { color: theme.textBlack }]}>Preferencias</Text>

                <FieldLabel theme={typedTheme} text="Dieta" />
                <View style={[styles.wrapRow, { gap: 8 }]}>
                  <Chip
                    key="none"
                    label="Ninguna"
                    selected={diet === null}
                    onPress={() => setDiet(null)}
                    theme={typedTheme}
                  />
                  {DIET_CODES.map((code) => (
                    <Chip
                      key={code}
                      label={DIET_LABELS[code]}
                      selected={diet === code}
                      onPress={() => setDiet(code)}
                      theme={typedTheme}
                    />
                  ))}
                </View>

                <FieldLabel theme={typedTheme} text="Restricciones duras" />
                <View style={[styles.wrapRow, { gap: 8 }]}>
                  {HARD_RESTRICTION_CODES.map((code) => (
                    <Chip
                      key={code}
                      label={HARD_RESTRICTION_LABELS[code]}
                      selected={hardRestrictions.includes(code)}
                      onPress={() => handleToggleHardRestriction(code)}
                      theme={typedTheme}
                    />
                  ))}
                </View>

                <FieldLabel theme={typedTheme} text="Preferencias suaves (coma)" />
                <TextInput
                  accessibilityLabel="profile-soft-preferences"
                  value={softPreferences}
                  onChangeText={setSoftPreferences}
                  placeholder="ej. cilantro, picante"
                  placeholderTextColor={theme.textLight}
                  style={[styles.input, { backgroundColor: theme.icon, color: theme.colorMedium }]}
                />
              </View>

              <View style={[styles.section, { gap: 16 }]}>
                <Text style={[styles.sectionTitle, { color: theme.textBlack }]}>
                  Tiempos por comida
                </Text>
                {MEAL_SLOTS.map((slot) => (
                  <SlotEditor
                    key={slot}
                    slot={slot}
                    value={slots[slot]}
                    onMinutesChange={(text) => handleSlotMinutesChange(slot, text)}
                    onHungerChange={(hunger) => handleSlotHungerChange(slot, hunger)}
                  />
                ))}
              </View>

              <View style={[styles.section, { gap: 12 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSave}
                  disabled={loadState.saving}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: theme.colorMedium,
                      opacity: loadState.saving ? 0.6 : pressed ? 0.9 : 1,
                    },
                  ]}>
                  {loadState.saving ? (
                    <ActivityIndicator size="small" color={theme.primaryAccent} />
                  ) : (
                    <Text style={[styles.primaryLabel, { color: theme.primaryAccent }]}>
                      Guardar cambios
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={signOut}
                  style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.8 : 1 }]}>
                  <Text style={[styles.mediumLabel, { color: theme.primaryAccent }]}>
                    Cerrar sesión
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaContent>
    </LinearGradient>
  );
}

function FieldLabel({ theme, text }: { theme: ThemeLike; text: string }) {
  return <Text style={[styles.fieldLabel, { color: theme.textBlack }]}>{text}</Text>;
}

function Chip({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: ThemeLike;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.colorMedium : theme.icon,
          borderColor: selected ? theme.colorMedium : 'transparent',
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <Text
        style={[styles.mediumLabel, { color: selected ? theme.primaryAccent : theme.textBlack }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SlotEditor({
  slot,
  value,
  onMinutesChange,
  onHungerChange,
}: {
  slot: MealSlot;
  value: SlotCookingTime;
  onMinutesChange: (text: string) => void;
  onHungerChange: (hunger: HungerLevel) => void;
}) {
  const { theme } = useRecipeTheme();
  const typedTheme = theme as unknown as ThemeLike;

  return (
    <View style={[styles.slotCard, { backgroundColor: theme.icon }]}>
      <Text style={[styles.slotTitle, { color: theme.colorMedium }]}>{SLOT_LABELS[slot]}</Text>

      <FieldLabel theme={typedTheme} text="Minutos de cocina (0 = no cocina)" />
      <TextInput
        accessibilityLabel={`${slot}-minutes`}
        value={String(value.cookingTimeMinutes)}
        onChangeText={onMinutesChange}
        keyboardType="number-pad"
        maxLength={3}
        style={[styles.input, { backgroundColor: theme.colorMedium, color: theme.primaryAccent }]}
      />

      <View style={[styles.row, { gap: 8 }]}>
        {HUNGER_LEVELS.map((hunger) => (
          <Chip
            key={hunger}
            label={hunger}
            selected={value.hungerLevel === hunger}
            onPress={() => onHungerChange(hunger)}
            theme={typedTheme}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10.5,
  },
  errorText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  header: {
    paddingHorizontal: 24.5,
    paddingTop: 21,
  },
  headerDetail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.25,
    lineHeight: 17.5,
    marginTop: 3.5,
  },
  headerName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 17.5,
    marginTop: 3.5,
  },
  input: {
    borderRadius: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 14,
    paddingVertical: 10.5,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 21,
  },
  mediumLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12.25,
    lineHeight: 17.5,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
  },
  row: {
    flexDirection: 'row',
  },
  screenTitle: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 28,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 10.5,
  },
  section: {
    paddingHorizontal: 24.5,
  },
  sectionTitle: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 15.75,
    lineHeight: 24.5,
  },
  slotCard: {
    borderRadius: 21,
    gap: 12,
    padding: 14,
  },
  slotTitle: {
    fontFamily: 'Montserrat_600SemiBold',
    fontSize: 14,
    lineHeight: 21,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
