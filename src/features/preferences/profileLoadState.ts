// Pure state machine for the Profile tab load + save flow.
//
// Extracted from `app/(tabs)/profile.tsx` so the success/failure
// transitions can be unit-tested without rendering React. The
// behavior maps to Judgment Day S2 (don't let a save overwrite the
// server row with empty defaults) and S3 (don't run two parallel
// PUTs that may half-fail without an explicit error path).

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadState {
  status: LoadStatus;
  /** True when a save PUT is in flight. */
  saving: boolean;
  /** Optional error from the most recent load or save. */
  error: unknown;
}

export const initialLoadState: LoadState = { status: 'idle', saving: false, error: null };

export function startLoading(state: LoadState): LoadState {
  if (state.status === 'loading' || state.status === 'ready') return state;
  return { ...state, status: 'loading', error: null };
}

export function loadSucceeded(state: LoadState): LoadState {
  return { ...state, status: 'ready', error: null };
}

export function loadFailed(state: LoadState, error: unknown): LoadState {
  // Distinct from "empty" — when load fails we keep the form
  // hidden so the user cannot save local defaults and overwrite the
  // server row. See S2 in the Judgment Day findings.
  return { ...state, status: 'error', error };
}

export function startSaving(state: LoadState): LoadState {
  if (state.status !== 'ready') return state;
  return { ...state, saving: true, error: null };
}

export function saveFinished(state: LoadState, error?: unknown): LoadState {
  if (error) {
    return { ...state, saving: false, error };
  }
  return { ...state, saving: false, error: null };
}

// Save is only legal when status === 'ready' AND saving === false.
export function canSave(state: LoadState): boolean {
  return state.status === 'ready' && !state.saving;
}
