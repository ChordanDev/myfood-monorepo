import { BUDGET_INPUT_PLACEHOLDER, BUDGET_LABEL } from '../constants/settingsLabels';
import type { BudgetDraft } from '../utils/settingsDraft';
import { formatBudgetMinimum } from '../utils/settingsFormatters';
import { SettingsField } from './SettingsField';
import { SettingsTextInput } from './SettingsTextInput';

interface BudgetEditorProps {
  draft: BudgetDraft;
  onChange: (draft: BudgetDraft) => void;
}

// The owner types the weekly Budget in whole pesos; the minimum is shown under it.
export function BudgetEditor({ draft, onChange }: BudgetEditorProps) {
  return (
    <SettingsField hint={formatBudgetMinimum(draft.minWeeklyBudgetCents)}>
      <SettingsTextInput
        accessibilityLabel={BUDGET_LABEL}
        keyboardType="number-pad"
        onChangeText={(text) => onChange({ ...draft, text })}
        placeholder={BUDGET_INPUT_PLACEHOLDER}
        testID="settings-budget-input"
        value={draft.text}
      />
    </SettingsField>
  );
}
