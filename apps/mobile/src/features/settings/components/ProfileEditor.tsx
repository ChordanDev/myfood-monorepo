import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import {
  COOKING_SKILL_LABELS,
  COOKING_SKILLS,
} from '@/features/preferences/constants/preferenceOptions';
import type { ProfileFormState } from '@/features/preferences/utils/profilePayload';
import { PROFILE_FIELD_LABELS, type ProfileField } from '../constants/settingsLabels';
import type { ProfileDraft, ProfileFieldError } from '../utils/settingsDraft';
import { HouseholdStepper } from './HouseholdStepper';
import { SettingsChip, SettingsChipGroup } from './SettingsChip';
import { SettingsField } from './SettingsField';
import { SettingsTextInput } from './SettingsTextInput';

interface ProfileEditorProps {
  draft: ProfileDraft;
  fieldError: ProfileFieldError | null;
  onChange: (draft: ProfileDraft) => void;
}

const FIELD_TEST_IDS: Record<ProfileField, string> = {
  displayName: 'display-name',
  householdSize: 'household-size',
  cookingSkill: 'cooking-skill',
};

// Edits the field of the row that opened the sheet. The profile endpoint
// takes the three fields together, so the ones with no stored value are
// asked for in the same sheet.
export function ProfileEditor({ draft, fieldError, onChange }: ProfileEditorProps) {
  const { theme } = useRecipeTheme();
  const { values } = draft;

  const change = (patch: Partial<ProfileFormState>) =>
    onChange({ ...draft, values: { ...values, ...patch } });

  const controls: Record<ProfileField, ReactNode> = {
    displayName: (
      <SettingsTextInput
        accessibilityLabel={PROFILE_FIELD_LABELS.displayName}
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={60}
        onChangeText={(displayName) => change({ displayName })}
        placeholder="Cómo te llamamos"
        testID="settings-input-display-name"
        value={values.displayName}
      />
    ),
    householdSize: (
      <HouseholdStepper
        value={values.householdSize}
        onChange={(householdSize) => change({ householdSize })}
      />
    ),
    cookingSkill: (
      <SettingsChipGroup>
        {COOKING_SKILLS.map((skill) => (
          <SettingsChip
            key={skill}
            label={COOKING_SKILL_LABELS[skill]}
            selected={values.cookingSkill === skill}
            onPress={() => change({ cookingSkill: skill })}
            testID={`settings-chip-cooking-skill-${skill}`}
          />
        ))}
      </SettingsChipGroup>
    ),
  };

  // The sheet title already names the row's own field, so only the extra ones get a label.
  const renderField = (field: ProfileField, showLabel: boolean) => (
    <SettingsField
      key={field}
      label={showLabel ? PROFILE_FIELD_LABELS[field] : undefined}
      error={fieldError?.field === field ? fieldError.message : null}
      errorTestID={`settings-field-error-${FIELD_TEST_IDS[field]}`}>
      {controls[field]}
    </SettingsField>
  );

  return (
    <>
      {renderField(draft.field, false)}
      {draft.missingFields.length > 0 ? (
        <Text
          testID="settings-missing-fields-note"
          style={[styles.note, { color: theme.textLight }]}>
          Para guardar necesitamos también estos datos de tu hogar.
        </Text>
      ) : null}
      {draft.missingFields.map((field) => renderField(field, true))}
    </>
  );
}

const styles = StyleSheet.create({
  note: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
});
