import type { ProfileFieldError, SettingsDraft } from '../utils/settingsDraft';
import { BudgetEditor } from './BudgetEditor';
import { DietEditor, HardRestrictionsEditor, SoftPreferencesEditor } from './PreferenceEditors';
import { ProfileEditor } from './ProfileEditor';
import { SlotTimeEditor } from './SlotTimeEditor';

interface SettingsEditorProps {
  draft: SettingsDraft;
  fieldError: ProfileFieldError | null;
  onChange: (draft: SettingsDraft) => void;
}

// Body of the editor sheet: picks the editor that matches the open draft.
export function SettingsEditor({ draft, fieldError, onChange }: SettingsEditorProps) {
  switch (draft.kind) {
    case 'profile':
      return <ProfileEditor draft={draft} fieldError={fieldError} onChange={onChange} />;
    case 'diet':
      return <DietEditor draft={draft} onChange={onChange} />;
    case 'hardRestrictions':
      return <HardRestrictionsEditor draft={draft} onChange={onChange} />;
    case 'softPreferences':
      return <SoftPreferencesEditor draft={draft} onChange={onChange} />;
    case 'slot':
      return <SlotTimeEditor draft={draft} onChange={onChange} />;
    case 'budget':
      return <BudgetEditor draft={draft} onChange={onChange} />;
  }
}
