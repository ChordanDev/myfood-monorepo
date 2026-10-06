import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/features/auth';
import type { SlotCookingTimes, UserPreferences } from '@/features/auth/types/auth';
import { defaultSlot } from '@/features/preferences/utils/onboardingSlot';
import {
  initialLoadState,
  loadFailed,
  loadSucceeded,
  startLoading,
  type LoadState,
} from '@/features/preferences/utils/profileLoadState';

// A slot the server left out falls back to the onboarding default instead
// of crashing the row that formats it.
function withEverySlot(slotTimes: SlotCookingTimes): SlotCookingTimes {
  return {
    breakfast: slotTimes.breakfast ?? defaultSlot(),
    lunch: slotTimes.lunch ?? defaultSlot(),
    dinner: slotTimes.dinner ?? defaultSlot(),
  };
}

// Container state of the settings screen: the account comes straight from
// `me`, while preferences and slot times are fetched here and stay null
// until a load succeeds.
export function useSettingsState() {
  const {
    me,
    isAuthenticated,
    isComplete,
    canUseApp,
    signOut,
    fetchUserPreferences,
    fetchSlotCookingTimes,
  } = useAuth();

  // Read once: the trial state should not flip while the screen is open.
  const [now] = useState(() => new Date());
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [slotTimes, setSlotTimes] = useState<SlotCookingTimes | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialLoadState);

  const loadData = useCallback(async () => {
    setLoadState((prev) => startLoading(prev));
    try {
      const [loadedPreferences, loadedSlotTimes] = await Promise.all([
        fetchUserPreferences(),
        fetchSlotCookingTimes(),
      ]);
      setPreferences(loadedPreferences);
      setSlotTimes(withEverySlot(loadedSlotTimes));
      setLoadState((prev) => loadSucceeded(prev));
    } catch (error) {
      // Distinct from "empty": nothing that depends on this data may be
      // edited, or a save would overwrite the server row with defaults.
      console.warn('[Settings] Failed to load preferences/slot times:', error);
      setLoadState((prev) => loadFailed(prev, error));
    }
  }, [fetchSlotCookingTimes, fetchUserPreferences]);

  // Only the first load is automatic. After a failure the status is
  // "error", so the user has to ask for the retry.
  useEffect(() => {
    if (isAuthenticated && isComplete && canUseApp && loadState.status === 'idle') {
      loadData();
    }
  }, [canUseApp, isAuthenticated, isComplete, loadData, loadState.status]);

  return {
    me,
    now,
    preferences,
    slotTimes,
    loadStatus: loadState.status,
    retryLoad: loadData,
    signOut,
  };
}
