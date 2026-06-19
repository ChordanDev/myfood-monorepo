import { Text, TextInput, View } from 'react-native';
import type { HungerLevel, MealSlot } from '@/features/auth/types/auth';
import { OnboardingChip } from '@/features/preferences/components/onboarding/OnboardingChip';
import { OnboardingSegmentChip } from '@/features/preferences/components/onboarding/OnboardingSegmentChip';
import {
  inputStyle,
  type OnboardingTheme,
} from '@/features/preferences/components/onboarding/OnboardingSectionCard';
import {
  HUNGER_LEVEL_LABELS,
  HUNGER_LEVELS,
  SLOT_LABELS,
  SLOT_PRESET_BUCKETS,
} from '@/features/preferences/constants/onboardingOptions';
import type { SlotFormState, SlotMode } from '@/features/preferences/utils/onboardingSlot';

interface SlotEditorProps {
  slot: MealSlot;
  form: SlotFormState;
  onModeChange: (mode: SlotMode) => void;
  onPresetChange: (value: number) => void;
  onCustomChange: (text: string) => void;
  onHungerChange: (hunger: HungerLevel) => void;
  theme: OnboardingTheme;
}

export function SlotEditor({
  slot,
  form,
  onModeChange,
  onPresetChange,
  onCustomChange,
  onHungerChange,
  theme,
}: SlotEditorProps) {
  return (
    <View
      style={{
        backgroundColor: theme.colorDark,
        borderColor: 'rgba(237, 232, 213, 0.08)',
        borderRadius: 28,
        borderWidth: 1,
        gap: 14,
        overflow: 'hidden',
        padding: 16,
      }}>
      <View style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text className="font-montserrat-bold text-lg" style={{ color: theme.textLight }}>
            {SLOT_LABELS[slot]}
          </Text>
          <Text className="font-inter-medium text-xs" style={{ color: theme.textMedium }}>
            Tiempo + nivel de hambre
          </Text>
        </View>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: theme.colorBlack,
            borderRadius: 999,
            height: 44,
            justifyContent: 'center',
            width: 44,
          }}>
          <Text className="font-montserrat-bold text-xl" style={{ color: theme.primaryAccent }}>
            {form.mode === 'noCook'
              ? '0'
              : form.mode === 'custom'
                ? form.customText || '—'
                : form.preset}
          </Text>
        </View>
      </View>

      <View
        style={{
          backgroundColor: theme.colorBlack,
          borderRadius: 999,
          flexDirection: 'row',
          gap: 4,
          padding: 4,
        }}>
        <OnboardingSegmentChip
          label="No cocino"
          selected={form.mode === 'noCook'}
          onPress={() => onModeChange('noCook')}
          theme={theme}
        />
        <OnboardingSegmentChip
          label="Rápido"
          selected={form.mode === 'preset'}
          onPress={() => onModeChange('preset')}
          theme={theme}
        />
        <OnboardingSegmentChip
          label="Manual"
          selected={form.mode === 'custom'}
          onPress={() => onModeChange('custom')}
          theme={theme}
        />
      </View>

      {form.mode === 'preset' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {SLOT_PRESET_BUCKETS.map((value) => (
            <OnboardingChip
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
          placeholderTextColor="rgba(237, 232, 213, 0.58)"
          style={inputStyle(theme)}
        />
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {HUNGER_LEVELS.map((hunger) => (
          <OnboardingChip
            key={hunger}
            label={HUNGER_LEVEL_LABELS[hunger]}
            selected={form.hunger === hunger}
            onPress={() => onHungerChange(hunger)}
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}
