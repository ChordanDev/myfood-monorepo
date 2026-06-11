// Pure helper that runs the two-step profile save sequentially and
// produces a deterministic outcome. Extracted from
// `app/(tabs)/profile.tsx` so the failure semantics (S3 — no parallel
// writes, no half-failed "success") can be unit-tested without
// rendering React.

export type SaveStep = 'idle' | 'preferences' | 'slots' | 'done';

export interface SaveStepResult {
  step: SaveStep;
  updatedPreferences?: unknown;
  updatedSlots?: unknown;
  error?: unknown;
}

export interface SequentialSaveOptions<TPrefs, TSlots> {
  savePreferences: () => Promise<TPrefs>;
  saveSlots: () => Promise<TSlots>;
}

export async function runSequentialProfileSave<TPrefs, TSlots>(
  options: SequentialSaveOptions<TPrefs, TSlots>
): Promise<SaveStepResult> {
  try {
    const updatedPreferences = await options.savePreferences();
    try {
      const updatedSlots = await options.saveSlots();
      return { step: 'done', updatedPreferences, updatedSlots };
    } catch (error) {
      return { step: 'slots', updatedPreferences, error };
    }
  } catch (error) {
    return { step: 'preferences', error };
  }
}
