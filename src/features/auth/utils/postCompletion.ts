// Pure helper that decides how the AuthContext should react after the
// `completeOnboarding` POST returns successfully. Extracted from
// `AuthContext.completeOnboarding` so the success/failure policy can be
// unit-tested without React or `fetch`.
//
// Policy (Judgment Day C2):
//   - The server has already accepted the onboarding row. The user is
//     legally complete. We MUST surface that to the gate immediately.
//   - The follow-up `refreshMe()` is a soft read; if it fails, we
//     retry with a short backoff and, if it still fails, swallow the
//     error: the next session restore will reconcile the local `me`
//     snapshot from the server, which still reports isComplete=true.

export interface PostCompletionState {
  /** Previous `isComplete` value before the POST fired. */
  wasComplete: boolean;
  /** Whether the POST returned 2xx. */
  persisted: boolean;
  /** Failure from the follow-up refreshMe(), if any. */
  refreshError: unknown;
}

export interface PostCompletionDecision {
  /** True if the local gate should treat the user as complete right now. */
  isComplete: boolean;
  /** True if a background refresh should be retried. */
  shouldRetryRefresh: boolean;
}

export function decidePostCompletion(previous: PostCompletionState): PostCompletionDecision {
  if (!previous.persisted) {
    return { isComplete: previous.wasComplete, shouldRetryRefresh: false };
  }
  // POST succeeded. Flip the gate optimistically.
  const isComplete = true;
  if (previous.refreshError === undefined || previous.refreshError === null) {
    return { isComplete, shouldRetryRefresh: false };
  }
  return { isComplete, shouldRetryRefresh: true };
}

// Sleep helper. Kept as an injected dependency so the retry loop in the
// context can be tested without real timers.
export type Delay = (ms: number) => Promise<void>;

export const defaultDelay: Delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  delay?: Delay;
  /** Returns true when the error is worth retrying (transient network). */
  shouldRetry?: (error: unknown) => boolean;
}

export interface RetryResult {
  attempts: number;
  outcome: 'success' | 'exhausted' | 'aborted';
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<RetryResult & { value?: T }> {
  const { maxAttempts, baseDelayMs, delay = defaultDelay, shouldRetry } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await operation();
      return { attempts: attempt, outcome: 'success', value };
    } catch (error) {
      if (shouldRetry && !shouldRetry(error)) {
        return { attempts: attempt, outcome: 'aborted' };
      }
      if (attempt < maxAttempts) {
        const backoff = baseDelayMs * 2 ** (attempt - 1);
        await delay(backoff);
      }
    }
  }

  return { attempts: maxAttempts, outcome: 'exhausted' };
}

// Higher-level orchestrator for the `completeOnboarding` flow.
//
// Inputs:
//   - `wasComplete`: previous optimistic flag
//   - `persisted`:   true if the POST returned 2xx
//   - `refresh`:     best-effort call to fetch a fresh /me snapshot
//   - `onOptimistic`:called once with true when we should flip the local gate
//   - `onRefreshed`: called with the new /me snapshot when the refresh succeeds
//   - `shouldRetry`: predicate to decide whether the refresh error is transient
//   - `maxAttempts`/`baseDelayMs`: retry tuning
//
// Behavior:
//   - If `persisted` is false, do nothing (the caller is responsible for
//     surfacing the POST error).
//   - If `persisted` is true, fire `onOptimistic(true)` and run the
//     refresh with exponential backoff.
//   - On success, fire `onRefreshed` with the new value.
//   - On exhaustion/abort, swallow the error — the user is complete
//     server-side; the next session restore will reconcile.
export interface ReconcileOptions<TRefresh> {
  wasComplete: boolean;
  persisted: boolean;
  refresh: () => Promise<TRefresh>;
  onOptimistic: (next: boolean) => void;
  onRefreshed: (value: TRefresh) => void;
  shouldRetry: (error: unknown) => boolean;
  maxAttempts?: number;
  baseDelayMs?: number;
  delay?: Delay;
}

export interface ReconcileResult<TRefresh> {
  refreshed: TRefresh | null;
  outcome: 'persisted' | 'no-persist' | 'refresh-success' | 'refresh-failed';
}

export async function reconcileAfterCompletion<TRefresh>(
  options: ReconcileOptions<TRefresh>
): Promise<ReconcileResult<TRefresh>> {
  if (!options.persisted) {
    return { refreshed: null, outcome: 'no-persist' };
  }

  options.onOptimistic(true);

  const result = await retryWithBackoff(options.refresh, {
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: options.baseDelayMs ?? 250,
    delay: options.delay,
    shouldRetry: options.shouldRetry,
  });

  if (result.outcome === 'success' && result.value !== undefined) {
    options.onRefreshed(result.value);
    return { refreshed: result.value, outcome: 'refresh-success' };
  }

  return { refreshed: null, outcome: 'refresh-failed' };
}
