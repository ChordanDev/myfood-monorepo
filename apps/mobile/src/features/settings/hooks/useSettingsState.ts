import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '@/api/errors';
import { fetchAccountBudget, updateAccountBudget } from '@/features/account/api/accountApi';
import { useAuth } from '@/features/auth';
import type {
  AccountBudget,
  ProfileUpdatePayload,
  SlotCookingTimes,
  UserPreferences,
} from '@/features/auth/types/auth';
import { PreferencesValidationError } from '@/features/preferences/utils/preferencesPayload';
import { buildProfilePayload } from '@/features/preferences/utils/profilePayload';
import { defaultSlot, defaultSlotCookingTimes } from '@/features/preferences/utils/slotCookingTime';
import { getAuthErrorMessage } from '@/services/authService';
import { PROFILE_FIELD_ERRORS } from '../constants/settingsLabels';
import {
  canSave,
  initialLoadState,
  loadFailed,
  loadSucceeded,
  saveFinished,
  startLoading,
  startSaving,
  type LoadState,
} from '../utils/profileLoadState';
import {
  buildBudgetEdit,
  buildPreferencesEdit,
  buildSlotTimesEdit,
  createBudgetDraft,
  createPreferenceDraft,
  createProfileDraft,
  createSlotDraft,
  isProfileField,
  type ProfileDraft,
  type ProfileFieldError,
  type SettingsDraft,
  type SettingsEditorTarget,
} from '../utils/settingsDraft';

/** The weekly Budget loads apart from the preferences: a failure of one leaves the other usable. */
export type BudgetStatus = 'loading' | 'ready' | 'error';

interface EditorSheetState {
  /** Kept apart from the draft so the content stays put while the sheet fades out. */
  visible: boolean;
  draft: SettingsDraft;
  /** Why the last save failed. */
  errorMessage: string | null;
  fieldError: ProfileFieldError | null;
}

// A slot the server left out falls back to the onboarding default instead
// of crashing the row that formats it.
function withEverySlot(slotTimes: SlotCookingTimes): SlotCookingTimes {
  return {
    breakfast: slotTimes.breakfast ?? defaultSlot(),
    lunch: slotTimes.lunch ?? defaultSlot(),
    dinner: slotTimes.dinner ?? defaultSlot(),
  };
}

// A user who never saved their slot times has no server row when the screen
// loads, so they start from the defaults. That can change before they save:
// another device may save in between, and the save replaces the whole set
// (see #104). Only that code means "none saved": any other failure is
// rethrown and fails the load.
function defaultsWhenNoneSaved(error: unknown): SlotCookingTimes {
  if (isApiError(error) && error.code === 'slot_cooking_times_not_found') {
    return defaultSlotCookingTimes();
  }
  throw error;
}

// Validation failures become an inline message next to the field. A field
// the sheet is not showing has no "next to", so its message goes to the
// sheet instead of being lost.
function describeProfileError(
  draft: ProfileDraft,
  error: PreferencesValidationError
): Pick<EditorSheetState, 'errorMessage' | 'fieldError'> {
  if (!isProfileField(error.field)) {
    return { errorMessage: getAuthErrorMessage(error), fieldError: null };
  }
  const message = PROFILE_FIELD_ERRORS[error.field];
  const isShown = error.field === draft.field || draft.missingFields.includes(error.field);
  return isShown
    ? { errorMessage: null, fieldError: { field: error.field, message } }
    : { errorMessage: message, fieldError: null };
}

// Container state of the settings screen: the account comes straight from
// `me`, while preferences and slot times are fetched here and stay null
// until a load succeeds. Each row edits through one sheet at a time.
export function useSettingsState() {
  const {
    me,
    isAuthenticated,
    isComplete,
    canUseApp,
    signOut,
    updateProfile,
    fetchUserPreferences,
    saveUserPreferences,
    fetchSlotCookingTimes,
    saveSlotCookingTimes,
  } = useAuth();

  // Read once: the trial state should not flip while the screen is open.
  const [now] = useState(() => new Date());
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [slotTimes, setSlotTimes] = useState<SlotCookingTimes | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialLoadState);
  const [sheet, setSheet] = useState<EditorSheetState | null>(null);
  // The profile does not depend on the loaded data, so its save is tracked
  // apart from the load state machine.
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [budget, setBudget] = useState<AccountBudget | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus>('loading');
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const isSaving = loadState.saving || isSavingProfile || isSavingBudget;
  // Every member sees the Budget; only the owner may change it (the API answers `not_owner`).
  const canEditBudget = me?.membership.role === 'owner' && budgetStatus === 'ready';

  const loadData = useCallback(async () => {
    setLoadState((prev) => startLoading(prev));
    try {
      const [loadedPreferences, loadedSlotTimes] = await Promise.all([
        fetchUserPreferences(),
        fetchSlotCookingTimes().catch(defaultsWhenNoneSaved),
      ]);
      setPreferences(loadedPreferences);
      setSlotTimes(withEverySlot(loadedSlotTimes));
      setLoadState((prev) => loadSucceeded(prev));
    } catch (error) {
      // Distinct from "none saved", which `defaultsWhenNoneSaved` resolves:
      // nothing that depends on this data may be edited, or a save would
      // overwrite the server row with defaults.
      console.warn('[Settings] Failed to load preferences/slot times:', error);
      setLoadState((prev) => loadFailed(prev, error));
    }
  }, [fetchSlotCookingTimes, fetchUserPreferences]);

  const loadBudget = useCallback(async () => {
    setBudgetStatus('loading');
    try {
      const response = await fetchAccountBudget();
      setBudget(response.budget);
      setBudgetStatus('ready');
    } catch (error) {
      console.warn('[Settings] Failed to load the weekly budget:', error);
      setBudgetStatus('error');
    }
  }, []);

  // Only the first load is automatic. After a failure the status is
  // "error", so the user has to ask for the retry.
  useEffect(() => {
    if (isAuthenticated && isComplete && canUseApp && loadState.status === 'idle') {
      loadData();
      loadBudget();
    }
  }, [canUseApp, isAuthenticated, isComplete, loadBudget, loadData, loadState.status]);

  // The retry also reloads a Budget that failed, but leaves a loaded one alone.
  const retryLoad = useCallback(() => {
    loadData();
    if (budgetStatus === 'error') loadBudget();
  }, [budgetStatus, loadBudget, loadData]);

  // Always a fresh draft from the saved value: a cancelled edit leaves no trace.
  const openEditor = useCallback(
    (target: SettingsEditorTarget) => {
      let draft: SettingsDraft;
      if (target.kind === 'profile') {
        if (!me) return;
        draft = createProfileDraft(me.user, target.field);
      } else if (target.kind === 'budget') {
        if (!canEditBudget || !budget) return;
        draft = createBudgetDraft(budget);
      } else {
        // Never over data that was not loaded: the save would overwrite it.
        if (loadState.status !== 'ready' || !preferences || !slotTimes) return;
        draft =
          target.kind === 'slot'
            ? createSlotDraft(target.slot, slotTimes)
            : createPreferenceDraft(target.kind, preferences);
      }
      setSheet({ visible: true, draft, errorMessage: null, fieldError: null });
    },
    [budget, canEditBudget, loadState.status, me, preferences, slotTimes]
  );

  const closeEditor = useCallback(() => {
    if (isSaving) return;
    setSheet((current) => current && { ...current, visible: false });
  }, [isSaving]);

  const changeDraft = useCallback((draft: SettingsDraft) => {
    setSheet((current) => current && { ...current, draft, fieldError: null });
  }, []);

  const saveEditor = useCallback(async () => {
    if (!sheet?.visible || isSaving) return;
    const { draft } = sheet;

    const hideSheet = () => setSheet((current) => current && { ...current, visible: false });
    const clearErrors = () =>
      setSheet((current) => current && { ...current, errorMessage: null, fieldError: null });
    const showSaveError = (error: unknown) =>
      setSheet(
        (current) =>
          current && { ...current, errorMessage: getAuthErrorMessage(error), fieldError: null }
      );

    if (draft.kind === 'profile') {
      let payload: ProfileUpdatePayload;
      try {
        payload = buildProfilePayload(draft.values);
      } catch (error) {
        if (!(error instanceof PreferencesValidationError)) throw error;
        const validation = describeProfileError(draft, error);
        setSheet((current) => current && { ...current, ...validation });
        return;
      }

      clearErrors();
      setIsSavingProfile(true);
      try {
        // The provider reflects the saved profile on `me`, which the rows read.
        await updateProfile(payload);
        hideSheet();
      } catch (error) {
        showSaveError(error);
      } finally {
        setIsSavingProfile(false);
      }
      return;
    }

    if (draft.kind === 'budget') {
      // Refused here with the same rules as the server, so nothing is sent.
      const edit = buildBudgetEdit(draft);
      if (!edit.ok) {
        setSheet(
          (current) => current && { ...current, errorMessage: edit.message, fieldError: null }
        );
        return;
      }

      clearErrors();
      setIsSavingBudget(true);
      try {
        const response = await updateAccountBudget(edit.payload);
        setBudget(response.budget);
        hideSheet();
      } catch (error) {
        showSaveError(error);
      } finally {
        setIsSavingBudget(false);
      }
      return;
    }

    if (!canSave(loadState) || !preferences || !slotTimes) return;
    clearErrors();
    setLoadState((prev) => startSaving(prev));
    try {
      if (draft.kind === 'slot') {
        const saved = await saveSlotCookingTimes(buildSlotTimesEdit(draft, slotTimes));
        setSlotTimes(withEverySlot(saved));
      } else {
        setPreferences(await saveUserPreferences(buildPreferencesEdit(draft, preferences)));
      }
      setLoadState((prev) => saveFinished(prev));
      hideSheet();
    } catch (error) {
      setLoadState((prev) => saveFinished(prev, error));
      showSaveError(error);
    }
  }, [
    isSaving,
    loadState,
    preferences,
    saveSlotCookingTimes,
    saveUserPreferences,
    sheet,
    slotTimes,
    updateProfile,
  ]);

  return {
    me,
    now,
    preferences,
    slotTimes,
    budget,
    budgetStatus,
    canEditBudget,
    loadStatus: loadState.status,
    retryLoad,
    signOut,
    sheet,
    isSaving,
    openEditor,
    closeEditor,
    changeDraft,
    saveEditor,
  };
}
