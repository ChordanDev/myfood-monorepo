import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../src/features/auth';
import { useRecipeTheme } from '../src/context/RecipeThemeContext';
import { NoisyBackground, SafeAreaContent } from '../src/components';
import { getAuthErrorMessage } from '../src/services/authService';
import type {
  CookingSkill,
  HungerLevel,
  MealSlot,
  OnboardingCompletionRequest,
  SlotCookingTime,
} from '../src/features/auth/types/auth';

const COOKING_SKILLS: readonly CookingSkill[] = ['beginner', 'intermediate', 'advanced'];
const HUNGER_LEVELS: readonly HungerLevel[] = ['light', 'normal', 'strong'];
const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

// Preset minute buckets shown in the UI. The spec requires serialization as
// integer minutes, so the buckets are simply integer values.
const SLOT_PRESET_BUCKETS: readonly number[] = [0, 10, 20, 30, 45, 60];

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

type SlotMode = 'noCook' | 'preset' | 'custom';

function buildSlot(mode: SlotMode, value: number, hunger: HungerLevel): SlotCookingTime {
  // Spec contract: no cook -> 0, preset -> bucket integer, custom -> integer minutes.
  if (mode === 'noCook') {
    return { cookingTimeMinutes: 0, hungerLevel: hunger };
  }
  if (mode === 'custom') {
    const safe = Math.max(0, Math.floor(value));
    return { cookingTimeMinutes: safe, hungerLevel: hunger };
  }
  return { cookingTimeMinutes: Math.max(0, Math.floor(value)), hungerLevel: hunger };
}

function defaultSlot(mode: SlotMode = 'noCook'): SlotCookingTime {
  return { cookingTimeMinutes: mode === 'noCook' ? 0 : 30, hungerLevel: 'normal' };
}

interface SlotFormState {
  mode: SlotMode;
  preset: number;
  customText: string;
  hunger: HungerLevel;
}

function buildSlotForm(slot: SlotCookingTime): SlotFormState {
  if (slot.cookingTimeMinutes === 0) {
    return { mode: 'noCook', preset: 30, customText: '', hunger: slot.hungerLevel };
  }
  if (SLOT_PRESET_BUCKETS.includes(slot.cookingTimeMinutes)) {
    return {
      mode: 'preset',
      preset: slot.cookingTimeMinutes,
      customText: '',
      hunger: slot.hungerLevel,
    };
  }
  return {
    mode: 'custom',
    preset: 30,
    customText: String(slot.cookingTimeMinutes),
    hunger: slot.hungerLevel,
  };
}

export default function OnboardingRoute() {
  const router = useRouter();
  const { theme } = useRecipeTheme();
  const { isAuthenticated, isLoading, isComplete, completeOnboarding, user, signOut } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [householdSize, setHouseholdSize] = useState('1');
  const [cookingSkill, setCookingSkill] = useState<CookingSkill>('beginner');
  const [diet, setDiet] = useState('');
  const [hardRestrictions, setHardRestrictions] = useState('');
  const [softPreferences, setSoftPreferences] = useState('');
  const [slots, setSlots] = useState<Record<MealSlot, SlotFormState>>(() => ({
    breakfast: buildSlotForm(defaultSlot()),
    lunch: buildSlotForm(defaultSlot()),
    dinner: buildSlotForm(defaultSlot()),
  }));
  const [submitting, setSubmitting] = useState(false);

  const trimmedDisplayName = useMemo(() => displayName.trim(), [displayName]);
  const trimmedDiet = useMemo(() => diet.trim(), [diet]);

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

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!isValid) {
      Alert.alert('Faltan datos', 'Revisá los campos obligatorios antes de continuar.');
      return;
    }

    const payload: OnboardingCompletionRequest = {
      profile: {
        displayName: trimmedDisplayName,
        householdSize: householdSizeNumber ?? 1,
        cookingSkill,
      },
      preferences: {
        diet: trimmedDiet.length > 0 ? trimmedDiet : null,
        hardRestrictions: hardRestrictions
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
        softPreferences: softPreferences
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      },
      slotCookingTimes: {
        breakfast: buildSlotPayload('breakfast'),
        lunch: buildSlotPayload('lunch'),
        dinner: buildSlotPayload('dinner'),
      },
    };

    setSubmitting(true);
    try {
      await completeOnboarding(payload);
      // AuthContext refreshes /me; the index gate will reroute based on
      // onboarding.isComplete + account.access.canUseApp.
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
    hardRestrictions,
    householdSizeNumber,
    isValid,
    router,
    softPreferences,
    submitting,
    trimmedDisplayName,
    trimmedDiet,
  ]);

  if (!isLoading && !isAuthenticated) {
    return <Redirect href="/" />;
  }

  if (!isLoading && isComplete) {
    return <Redirect href="/" />;
  }

  return (
    <LinearGradient
      colors={[theme.colorBlack, theme.colorDark, theme.colorMedium]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}>
      <NoisyBackground opacity={0.2} />
      <SafeAreaContent>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: 40, gap: 24 }}
          keyboardShouldPersistTaps="handled">
          <View className="px-7 pt-6">
            <Text className="font-montserrat-bold text-[28px]" style={{ color: theme.textBlack }}>
              Configurá tu cuenta
            </Text>
            <Text
              className="font-inter-regular mt-2 text-sm"
              style={{ color: theme.primaryAccent }}>
              Necesitamos unos datos para personalizar tus comidas. Podés editarlos más tarde desde
              el perfil.
            </Text>
          </View>

          <View className="px-7" style={{ gap: 16 }}>
            <Text className="font-montserrat-semibold text-lg" style={{ color: theme.textBlack }}>
              Tu perfil
            </Text>

            <FieldLabel theme={theme} text="Nombre para mostrar" />
            <TextInput
              accessibilityLabel="displayName"
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={60}
              placeholder="Cómo te llamamos"
              placeholderTextColor={theme.textLight}
              className="font-inter-regular rounded-2xl px-4 py-3 text-base"
              style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
            />

            <FieldLabel theme={theme} text="Personas en casa (1-20)" />
            <TextInput
              accessibilityLabel="householdSize"
              value={householdSize}
              onChangeText={(text) => setHouseholdSize(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={2}
              className="font-inter-regular rounded-2xl px-4 py-3 text-base"
              style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
            />

            <FieldLabel theme={theme} text="Tu experiencia cocinando" />
            <View className="flex-row" style={{ gap: 8 }}>
              {COOKING_SKILLS.map((skill) => (
                <Chip
                  key={skill}
                  label={skill}
                  selected={cookingSkill === skill}
                  onPress={() => setCookingSkill(skill)}
                  theme={theme}
                />
              ))}
            </View>
          </View>

          <View className="px-7" style={{ gap: 16 }}>
            <Text className="font-montserrat-semibold text-lg" style={{ color: theme.textBlack }}>
              Tus preferencias
            </Text>

            <FieldLabel theme={theme} text="Dieta (opcional)" />
            <TextInput
              accessibilityLabel="diet"
              value={diet}
              onChangeText={setDiet}
              placeholder="omnívoro, vegetariano, pescatariano..."
              placeholderTextColor={theme.textLight}
              className="font-inter-regular rounded-2xl px-4 py-3 text-base"
              style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
            />

            <FieldLabel theme={theme} text="Restricciones duras (separadas por coma)" />
            <TextInput
              accessibilityLabel="hardRestrictions"
              value={hardRestrictions}
              onChangeText={setHardRestrictions}
              placeholder="ej. maní, gluten"
              placeholderTextColor={theme.textLight}
              className="font-inter-regular rounded-2xl px-4 py-3 text-base"
              style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
            />

            <FieldLabel theme={theme} text="Preferencias suaves (separadas por coma)" />
            <TextInput
              accessibilityLabel="softPreferences"
              value={softPreferences}
              onChangeText={setSoftPreferences}
              placeholder="ej. cilantro, picante"
              placeholderTextColor={theme.textLight}
              className="font-inter-regular rounded-2xl px-4 py-3 text-base"
              style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
            />
          </View>

          <View className="px-7" style={{ gap: 16 }}>
            <Text className="font-montserrat-semibold text-lg" style={{ color: theme.textBlack }}>
              Tiempos por comida
            </Text>
            <Text className="font-inter-regular text-xs" style={{ color: theme.primaryAccent }}>
              Indicá cuántos minutos dedicás a cocinar cada comida. Si no cocinás, elegí “No
              cocino”.
            </Text>
            {MEAL_SLOTS.map((slot) => (
              <SlotEditor
                key={slot}
                slot={slot}
                form={slots[slot]}
                onModeChange={(mode) => handleSlotModeChange(slot, mode)}
                onPresetChange={(value) => handleSlotPresetChange(slot, value)}
                onCustomChange={(text) => handleSlotCustomChange(slot, text)}
                onHungerChange={(hunger) => handleSlotHungerChange(slot, hunger)}
              />
            ))}
          </View>

          <View className="px-7" style={{ gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              onPress={handleSubmit}
              disabled={!isValid || submitting}
              className="items-center rounded-2xl py-4 active:opacity-90"
              style={{
                backgroundColor: theme.colorMedium,
                opacity: !isValid || submitting ? 0.6 : 1,
              }}>
              {submitting ? (
                <ActivityIndicator size="small" color={theme.primaryAccent} />
              ) : (
                <Text
                  className="font-inter-semibold text-base"
                  style={{ color: theme.primaryAccent }}>
                  Guardar y continuar
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={signOut}
              className="items-center rounded-2xl py-3 active:opacity-80">
              <Text className="font-inter-medium text-sm" style={{ color: theme.primaryAccent }}>
                Cerrar sesión
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaContent>
    </LinearGradient>
  );
}

interface ThemeLike {
  icon: string;
  colorMedium: string;
  textBlack: string;
  textLight: string;
  primaryAccent: string;
}

function FieldLabel({ theme, text }: { theme: ThemeLike; text: string }) {
  return (
    <Text className="font-inter-semibold text-sm" style={{ color: theme.textBlack }}>
      {text}
    </Text>
  );
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
      onPress={onPress}
      className="flex-1 items-center rounded-2xl py-3 active:opacity-80"
      style={{
        backgroundColor: selected ? theme.colorMedium : theme.icon,
        borderWidth: 1,
        borderColor: selected ? theme.colorMedium : 'transparent',
      }}>
      <Text
        className="font-inter-medium text-sm capitalize"
        style={{ color: selected ? theme.primaryAccent : theme.textBlack }}>
        {label}
      </Text>
    </Pressable>
  );
}

function SlotEditor({
  slot,
  form,
  onModeChange,
  onPresetChange,
  onCustomChange,
  onHungerChange,
}: {
  slot: MealSlot;
  form: SlotFormState;
  onModeChange: (mode: SlotMode) => void;
  onPresetChange: (value: number) => void;
  onCustomChange: (text: string) => void;
  onHungerChange: (hunger: HungerLevel) => void;
}) {
  const theme = useRecipeTheme().theme as unknown as ThemeLike;

  return (
    <View className="rounded-3xl p-4" style={{ backgroundColor: theme.icon, gap: 12 }}>
      <Text className="font-montserrat-semibold text-base" style={{ color: theme.colorMedium }}>
        {SLOT_LABELS[slot]}
      </Text>

      <View className="flex-row" style={{ gap: 8 }}>
        <Chip
          label="No cocino"
          selected={form.mode === 'noCook'}
          onPress={() => onModeChange('noCook')}
          theme={theme}
        />
        <Chip
          label="Preset"
          selected={form.mode === 'preset'}
          onPress={() => onModeChange('preset')}
          theme={theme}
        />
        <Chip
          label="Custom"
          selected={form.mode === 'custom'}
          onPress={() => onModeChange('custom')}
          theme={theme}
        />
      </View>

      {form.mode === 'preset' ? (
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {SLOT_PRESET_BUCKETS.map((value) => (
            <Chip
              key={value}
              label={`${value} min`}
              selected={form.preset === value}
              onPress={() => onPresetChange(value)}
              theme={theme}
            />
          ))}
        </View>
      ) : null}

      {form.mode === 'custom' ? (
        <TextInput
          accessibilityLabel={`${slot}-custom-minutes`}
          value={form.customText}
          onChangeText={onCustomChange}
          keyboardType="number-pad"
          placeholder="Minutos personalizados"
          placeholderTextColor={theme.textLight}
          className="font-inter-regular rounded-2xl px-4 py-3 text-base"
          style={{ backgroundColor: theme.colorMedium, color: theme.primaryAccent }}
        />
      ) : null}

      <View className="flex-row" style={{ gap: 8 }}>
        {HUNGER_LEVELS.map((hunger) => (
          <Chip
            key={hunger}
            label={hunger}
            selected={form.hunger === hunger}
            onPress={() => onHungerChange(hunger)}
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}
