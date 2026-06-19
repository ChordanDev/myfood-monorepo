import type { HungerLevel, MealSlot } from '@/features/auth/types/auth';
import { MEAL_SLOTS } from '@/features/preferences/constants/onboardingOptions';
import {
  OnboardingSectionCard,
  type OnboardingTheme,
} from '@/features/preferences/components/onboarding/OnboardingSectionCard';
import { SlotEditor } from '@/features/preferences/components/onboarding/SlotEditor';
import type { SlotFormState, SlotMode } from '@/features/preferences/utils/onboardingSlot';

interface MealTimesSectionProps {
  onSlotCustomChange: (slot: MealSlot, text: string) => void;
  onSlotHungerChange: (slot: MealSlot, hunger: HungerLevel) => void;
  onSlotModeChange: (slot: MealSlot, mode: SlotMode) => void;
  onSlotPresetChange: (slot: MealSlot, value: number) => void;
  slots: Record<MealSlot, SlotFormState>;
  theme: OnboardingTheme;
}

export function MealTimesSection({
  onSlotCustomChange,
  onSlotHungerChange,
  onSlotModeChange,
  onSlotPresetChange,
  slots,
  theme,
}: MealTimesSectionProps) {
  return (
    <OnboardingSectionCard
      kicker="Por último, rutina real"
      subtitle="Elegí tiempo y hambre por comida. Mejor una respuesta honesta que un plan imposible."
      theme={theme}
      title="Tiempos por comida">
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
    </OnboardingSectionCard>
  );
}
