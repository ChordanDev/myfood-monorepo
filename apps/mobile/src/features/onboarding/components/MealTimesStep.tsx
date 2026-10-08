import { View } from 'react-native';
import type { CookingTimeSlot, HungerLevel } from '@/features/auth/types/auth';
import type { RecipeThemeConfig } from '@/types/domain';
import { MEAL_SLOTS } from '@/features/preferences/constants/preferenceOptions';
import { SlotEditor } from '@/features/onboarding/components/SlotEditor';
import type { SlotFormState, SlotMode } from '@/features/onboarding/utils/onboardingSlot';

interface MealTimesStepProps {
  onSlotCustomChange: (slot: CookingTimeSlot, text: string) => void;
  onSlotHungerChange: (slot: CookingTimeSlot, hunger: HungerLevel) => void;
  onSlotModeChange: (slot: CookingTimeSlot, mode: SlotMode) => void;
  onSlotPresetChange: (slot: CookingTimeSlot, value: number) => void;
  slots: Record<CookingTimeSlot, SlotFormState>;
  theme: RecipeThemeConfig;
}

// Step 3, "Tiempos por comida": one card per meal of the day.
export function MealTimesStep({
  onSlotCustomChange,
  onSlotHungerChange,
  onSlotModeChange,
  onSlotPresetChange,
  slots,
  theme,
}: MealTimesStepProps) {
  return (
    <View style={{ gap: 14 }}>
      {MEAL_SLOTS.map((slot) => (
        <SlotEditor
          key={slot}
          slot={slot}
          form={slots[slot]}
          onModeChange={(mode) => onSlotModeChange(slot, mode)}
          onPresetChange={(value) => onSlotPresetChange(slot, value)}
          onCustomChange={(text) => onSlotCustomChange(slot, text)}
          onHungerChange={(hunger) => onSlotHungerChange(slot, hunger)}
          theme={theme}
        />
      ))}
    </View>
  );
}
