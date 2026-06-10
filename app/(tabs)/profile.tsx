import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../src/features/auth';
import { useRecipeTheme } from '../../src/context/RecipeThemeContext';
import { NoisyBackground, SafeAreaContent } from '../../src/components';
import { getAuthErrorMessage } from '../../src/services/authService';
import type {
  HungerLevel,
  MealSlot,
  SlotCookingTime,
  UserPreferences,
} from '../../src/features/auth/types/auth';

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

export default function ProfileRoute() {
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

  const [dietInput, setDietInput] = useState('');
  const [hardRestrictionsInput, setHardRestrictionsInput] = useState('');
  const [softPreferencesInput, setSoftPreferencesInput] = useState('');
  const [slots, setSlots] = useState<Record<MealSlot, SlotCookingTime>>({
    breakfast: DEFAULT_SLOT,
    lunch: DEFAULT_SLOT,
    dinner: DEFAULT_SLOT,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [prefs, slotTimes] = await Promise.all([
        fetchUserPreferences(),
        fetchSlotCookingTimes(),
      ]);
      setDietInput(prefs.diet ?? '');
      setHardRestrictionsInput(prefs.hardRestrictions.join(', '));
      setSoftPreferencesInput(prefs.softPreferences.join(', '));
      setSlots({
        breakfast: slotTimes.breakfast ?? DEFAULT_SLOT,
        lunch: slotTimes.lunch ?? DEFAULT_SLOT,
        dinner: slotTimes.dinner ?? DEFAULT_SLOT,
      });
    } catch (error) {
      Alert.alert('No pudimos cargar tus datos', getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [fetchSlotCookingTimes, fetchUserPreferences]);

  useEffect(() => {
    if (isAuthenticated && isComplete && canUseApp) {
      loadData();
    }
  }, [canUseApp, isAuthenticated, isComplete, loadData]);

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

  const buildPayload = useCallback((): {
    preferences: UserPreferences;
    slotCookingTimes: Record<MealSlot, SlotCookingTime>;
  } => {
    const splitList = (raw: string) =>
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return {
      preferences: {
        diet: dietInput.trim().length > 0 ? dietInput.trim() : null,
        hardRestrictions: splitList(hardRestrictionsInput),
        softPreferences: splitList(softPreferencesInput),
      },
      slotCookingTimes: slots,
    };
  }, [dietInput, hardRestrictionsInput, slots, softPreferencesInput]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = buildPayload();
      const [updatedPrefs] = await Promise.all([
        saveUserPreferences(payload.preferences),
        saveSlotCookingTimes(payload.slotCookingTimes),
      ]);
      setDietInput(updatedPrefs.diet ?? '');
      setHardRestrictionsInput(updatedPrefs.hardRestrictions.join(', '));
      setSoftPreferencesInput(updatedPrefs.softPreferences.join(', '));
      Alert.alert('Listo', 'Tus cambios se guardaron.');
    } catch (error) {
      Alert.alert('No pudimos guardar', getAuthErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [buildPayload, saveSlotCookingTimes, saveUserPreferences, saving]);

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
              Tu perfil
            </Text>
            {user ? (
              <Text
                selectable
                className="font-inter-regular mt-1 text-sm"
                style={{ color: theme.primaryAccent }}>
                {user.email}
              </Text>
            ) : null}
            {me?.user.displayName ? (
              <Text className="mt-1 font-inter-medium text-sm" style={{ color: theme.textLight }}>
                Nombre: {me.user.displayName}
              </Text>
            ) : null}
          </View>

          {loading ? (
            <View className="items-center py-6">
              <ActivityIndicator size="small" color={theme.primaryAccent} />
            </View>
          ) : null}

          {!loading ? (
            <>
              <View className="px-7" style={{ gap: 16 }}>
                <Text
                  className="font-montserrat-semibold text-lg"
                  style={{ color: theme.textBlack }}>
                  Preferencias
                </Text>

                <FieldLabel theme={typedTheme} text="Dieta" />
                <TextInput
                  accessibilityLabel="profile-diet"
                  value={dietInput}
                  onChangeText={setDietInput}
                  placeholder="omnívoro, vegetariano..."
                  placeholderTextColor={theme.textLight}
                  className="font-inter-regular rounded-2xl px-4 py-3 text-base"
                  style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
                />

                <FieldLabel theme={typedTheme} text="Restricciones duras (coma)" />
                <TextInput
                  accessibilityLabel="profile-hard-restrictions"
                  value={hardRestrictionsInput}
                  onChangeText={setHardRestrictionsInput}
                  placeholder="ej. maní, gluten"
                  placeholderTextColor={theme.textLight}
                  className="font-inter-regular rounded-2xl px-4 py-3 text-base"
                  style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
                />

                <FieldLabel theme={typedTheme} text="Preferencias suaves (coma)" />
                <TextInput
                  accessibilityLabel="profile-soft-preferences"
                  value={softPreferencesInput}
                  onChangeText={setSoftPreferencesInput}
                  placeholder="ej. cilantro, picante"
                  placeholderTextColor={theme.textLight}
                  className="font-inter-regular rounded-2xl px-4 py-3 text-base"
                  style={{ backgroundColor: theme.icon, color: theme.colorMedium }}
                />
              </View>

              <View className="px-7" style={{ gap: 16 }}>
                <Text
                  className="font-montserrat-semibold text-lg"
                  style={{ color: theme.textBlack }}>
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

              <View className="px-7" style={{ gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleSave}
                  disabled={saving}
                  className="items-center rounded-2xl py-4 active:opacity-90"
                  style={{
                    backgroundColor: theme.colorMedium,
                    opacity: saving ? 0.6 : 1,
                  }}>
                  {saving ? (
                    <ActivityIndicator size="small" color={theme.primaryAccent} />
                  ) : (
                    <Text
                      className="font-inter-semibold text-base"
                      style={{ color: theme.primaryAccent }}>
                      Guardar cambios
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={signOut}
                  className="items-center rounded-2xl py-3 active:opacity-80">
                  <Text
                    className="font-inter-medium text-sm"
                    style={{ color: theme.primaryAccent }}>
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
    <View className="rounded-3xl p-4" style={{ backgroundColor: theme.icon, gap: 12 }}>
      <Text className="font-montserrat-semibold text-base" style={{ color: theme.colorMedium }}>
        {SLOT_LABELS[slot]}
      </Text>

      <FieldLabel theme={typedTheme} text="Minutos de cocina (0 = no cocina)" />
      <TextInput
        accessibilityLabel={`${slot}-minutes`}
        value={String(value.cookingTimeMinutes)}
        onChangeText={onMinutesChange}
        keyboardType="number-pad"
        maxLength={3}
        className="font-inter-regular rounded-2xl px-4 py-3 text-base"
        style={{ backgroundColor: theme.colorMedium, color: theme.primaryAccent }}
      />

      <View className="flex-row" style={{ gap: 8 }}>
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
