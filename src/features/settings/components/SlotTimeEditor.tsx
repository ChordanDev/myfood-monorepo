import type { HungerLevel } from '@/features/auth/types/auth';
import {
  HUNGER_LEVEL_LABELS,
  HUNGER_LEVELS,
} from '@/features/preferences/constants/onboardingOptions';
import { buildSlot } from '@/features/preferences/utils/onboardingSlot';
import type { SlotDraft } from '../utils/settingsDraft';
import { formatCookingTime } from '../utils/settingsFormatters';
import { SettingsChip, SettingsChipGroup } from './SettingsChip';
import { SettingsField } from './SettingsField';

interface SlotTimeEditorProps {
  draft: SlotDraft;
  onChange: (draft: SlotDraft) => void;
}

export function SlotTimeEditor({ draft, onChange }: SlotTimeEditorProps) {
  const { cookingTimeMinutes, hungerLevel } = draft.value;

  const change = (minutes: number, hunger: HungerLevel) =>
    onChange({
      ...draft,
      value: buildSlot(minutes === 0 ? 'noCook' : 'preset', minutes, hunger),
    });

  return (
    <>
      <SettingsField label="Tiempo de cocina">
        <SettingsChipGroup>
          {draft.minuteOptions.map((minutes) => (
            <SettingsChip
              key={minutes}
              label={formatCookingTime(minutes)}
              selected={cookingTimeMinutes === minutes}
              onPress={() => change(minutes, hungerLevel)}
              testID={`settings-chip-minutes-${minutes}`}
            />
          ))}
        </SettingsChipGroup>
      </SettingsField>

      <SettingsField label="Nivel de hambre">
        <SettingsChipGroup>
          {HUNGER_LEVELS.map((hunger) => (
            <SettingsChip
              key={hunger}
              label={HUNGER_LEVEL_LABELS[hunger]}
              selected={hungerLevel === hunger}
              onPress={() => change(cookingTimeMinutes, hunger)}
              testID={`settings-chip-hunger-${hunger}`}
            />
          ))}
        </SettingsChipGroup>
      </SettingsField>
    </>
  );
}
