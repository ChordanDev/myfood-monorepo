import {
  DIET_CODES,
  DIET_LABELS,
  HARD_RESTRICTION_CODES,
  HARD_RESTRICTION_LABELS,
} from '@/features/preferences/constants/catalog';
import { PREFERENCE_FIELD_LABELS } from '../constants/settingsLabels';
import {
  toggleHardRestriction,
  type DietDraft,
  type HardRestrictionsDraft,
  type SoftPreferencesDraft,
} from '../utils/settingsDraft';
import { SettingsChip, SettingsChipGroup } from './SettingsChip';
import { SettingsField } from './SettingsField';
import { SettingsTextInput } from './SettingsTextInput';

interface EditorProps<TDraft> {
  draft: TDraft;
  onChange: (draft: TDraft) => void;
}

export function DietEditor({ draft, onChange }: EditorProps<DietDraft>) {
  return (
    <SettingsField>
      <SettingsChipGroup>
        <SettingsChip
          label="Sin preferencia"
          selected={draft.diet === null}
          onPress={() => onChange({ ...draft, diet: null })}
          testID="settings-chip-diet-none"
        />
        {DIET_CODES.map((code) => (
          <SettingsChip
            key={code}
            label={DIET_LABELS[code]}
            selected={draft.diet === code}
            onPress={() => onChange({ ...draft, diet: code })}
            testID={`settings-chip-diet-${code}`}
          />
        ))}
      </SettingsChipGroup>
    </SettingsField>
  );
}

function describeUnknownRestrictions(count: number): string {
  return count === 1
    ? 'Tenés 1 restricción más que esta versión no puede mostrar. Se conserva al guardar.'
    : `Tenés ${count} restricciones más que esta versión no puede mostrar. Se conservan al guardar.`;
}

export function HardRestrictionsEditor({ draft, onChange }: EditorProps<HardRestrictionsDraft>) {
  const unknownCount = draft.unknownCodes.length;

  return (
    <SettingsField
      hint={
        unknownCount > 0
          ? describeUnknownRestrictions(unknownCount)
          : 'Marcá solo lo que no se puede negociar.'
      }>
      <SettingsChipGroup>
        {HARD_RESTRICTION_CODES.map((code) => (
          <SettingsChip
            key={code}
            label={HARD_RESTRICTION_LABELS[code]}
            selected={draft.selected.includes(code)}
            onPress={() =>
              onChange({ ...draft, selected: toggleHardRestriction(draft.selected, code) })
            }
            testID={`settings-chip-hard-restriction-${code}`}
          />
        ))}
      </SettingsChipGroup>
    </SettingsField>
  );
}

export function SoftPreferencesEditor({ draft, onChange }: EditorProps<SoftPreferencesDraft>) {
  return (
    <SettingsField hint="Separalas con comas.">
      <SettingsTextInput
        accessibilityLabel={PREFERENCE_FIELD_LABELS.softPreferences}
        autoCapitalize="none"
        onChangeText={(text) => onChange({ ...draft, text })}
        placeholder="ej. cilantro, picante"
        testID="settings-input-soft-preferences"
        value={draft.text}
      />
    </SettingsField>
  );
}
