import { useRef } from 'react';
import { Pressable, Text, type TextInput, View } from 'react-native';
import type { HungerLevel, MealSlot } from '@/features/auth/types/auth';
import type { RecipeThemeConfig } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import { OnboardingChoiceChip } from '@/features/onboarding/components/OnboardingChoiceChip';
import {
  OnboardingField,
  OnboardingFieldHint,
} from '@/features/onboarding/components/OnboardingField';
import { OnboardingTextInput } from '@/features/onboarding/components/OnboardingTextInput';
import {
  HUNGER_LEVEL_LABELS,
  HUNGER_LEVELS,
  SLOT_LABELS,
  SLOT_PRESET_BUCKETS,
} from '@/features/preferences/constants/preferenceOptions';
import type { SlotFormState, SlotMode } from '@/features/onboarding/utils/onboardingSlot';

interface SlotEditorProps {
  slot: MealSlot;
  form: SlotFormState;
  onModeChange: (mode: SlotMode) => void;
  onPresetChange: (value: number) => void;
  onCustomChange: (text: string) => void;
  onHungerChange: (hunger: HungerLevel) => void;
  theme: RecipeThemeConfig;
}

const MODE_LABELS: readonly { mode: SlotMode; label: string }[] = [
  { mode: 'noCook', label: 'No cocino' },
  { mode: 'preset', label: 'Rápido' },
  { mode: 'custom', label: 'Manual' },
];

// The bucket list includes 0, which is what "No cocino" already means.
const QUICK_PRESETS = SLOT_PRESET_BUCKETS.filter((minutes) => minutes > 0);

const chipRowStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const;

// One meal of the day: how long the user has to cook it and how hungry they are.
export function SlotEditor({
  slot,
  form,
  onModeChange,
  onPresetChange,
  onCustomChange,
  onHungerChange,
  theme,
}: SlotEditorProps) {
  const minutesInputRef = useRef<TextInput>(null);
  const slotLabel = SLOT_LABELS[slot];
  const outlineColor = withOpacity(theme.colorDark, 0.3);

  return (
    <OnboardingField label={slotLabel} theme={theme}>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 8 }}>
          <OnboardingFieldHint text="Tiempo para cocinar" theme={theme} />
          <View
            accessibilityLabel={`${slotLabel}: tiempo para cocinar`}
            accessibilityRole="radiogroup"
            style={chipRowStyle}>
            {MODE_LABELS.map(({ mode, label }) => (
              <OnboardingChoiceChip
                key={mode}
                label={label}
                onPress={() => onModeChange(mode)}
                selected={form.mode === mode}
                theme={theme}
              />
            ))}
          </View>

          {form.mode === 'preset' ? (
            <View
              accessibilityLabel={`${slotLabel}: minutos`}
              accessibilityRole="radiogroup"
              style={chipRowStyle}>
              {QUICK_PRESETS.map((minutes) => (
                <OnboardingChoiceChip
                  key={minutes}
                  label={`${minutes} min`}
                  onPress={() => onPresetChange(minutes)}
                  selected={form.preset === minutes}
                  theme={theme}
                />
              ))}
            </View>
          ) : null}

          {form.mode === 'custom' ? (
            // Outlined like an unselected chip; the whole row focuses the input.
            <Pressable
              accessible={false}
              onPress={() => minutesInputRef.current?.focus()}
              style={{
                alignItems: 'center',
                borderColor: outlineColor,
                borderRadius: 22,
                borderWidth: 1,
                flexDirection: 'row',
                gap: 8,
                minHeight: 44,
                paddingHorizontal: 16,
              }}>
              <OnboardingTextInput
                ref={minutesInputRef}
                accessibilityLabel={`Minutos de ${slotLabel}`}
                keyboardType="number-pad"
                onChangeText={onCustomChange}
                placeholder="Minutos"
                returnKeyType="done"
                style={{ flex: 1, fontSize: 17 }}
                theme={theme}
                value={form.customText}
              />
              <Text
                style={{
                  color: withOpacity(theme.textBlack, 0.6),
                  fontFamily: 'Inter_500Medium',
                  fontSize: 14,
                  lineHeight: 20,
                }}>
                min
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={{ backgroundColor: outlineColor, height: 1 }} />

        <View style={{ gap: 8 }}>
          <OnboardingFieldHint text="Nivel de hambre" theme={theme} />
          <View
            accessibilityLabel={`${slotLabel}: nivel de hambre`}
            accessibilityRole="radiogroup"
            style={chipRowStyle}>
            {HUNGER_LEVELS.map((hunger) => (
              <OnboardingChoiceChip
                key={hunger}
                label={HUNGER_LEVEL_LABELS[hunger]}
                onPress={() => onHungerChange(hunger)}
                selected={form.hunger === hunger}
                theme={theme}
              />
            ))}
          </View>
        </View>
      </View>
    </OnboardingField>
  );
}
