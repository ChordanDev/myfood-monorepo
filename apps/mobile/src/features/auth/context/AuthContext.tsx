import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type {
  AuthContextValue,
  AuthFlow,
  AuthSession,
  CurrentMe,
  OnboardingCompletionRequest,
  OnboardingCompletionResponse,
  ProfileUpdatePayload,
  ProfileUpdateResponse,
  ProfileUpdateUser,
  SlotCookingTimes,
  SlotCookingTimesPayload,
  UserPreferences,
  UserPreferencesPayload,
} from '../types/auth';
import * as authService from '@/services/authService';
import { isTransientAuthError } from '@/services/authService';
import { normalizeProfileFields, withUpdatedProfile } from '../utils/currentMe';
import { reconcileAfterCompletion } from '../utils/postCompletion';

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

function getAccessState(me: CurrentMe | null) {
  const canUseApp = me?.account.access.canUseApp ?? false;
  const accessReason = me?.account.access.reason ?? null;

  return {
    canUseApp,
    accessReason,
    isTrialExpired: !canUseApp && accessReason === 'trial_expired',
  };
}

function withLocalTrialExpired(me: CurrentMe): CurrentMe {
  return {
    ...me,
    account: {
      ...me.account,
      access: { canUseApp: false, reason: 'trial_expired' },
    },
  };
}

function getTrialExpiryDelay(me: CurrentMe | null): number | null {
  // Closed union in auth.ts makes this exhaustive at compile time.
  if (!me?.account.access.canUseApp || me.account.subscriptionStatus === 'active') return null;
  if (!me.account.trialEndsAt) return null;

  const expiresAt = new Date(me.account.trialEndsAt).getTime();
  if (!Number.isFinite(expiresAt)) return null;

  return Math.max(expiresAt - Date.now(), 0);
}

function hasCompleteSession(
  me: CurrentMe | null,
  accessToken: string | null,
  refreshToken: string | null
): boolean {
  return me !== null && accessToken !== null && refreshToken !== null;
}

/**
 * Deep-equal comparison for CurrentMe values that ignores object
 * reference identity. Used by `applySession` to decide whether a
 * freshly fetched `/me` snapshot is content-equal to the one already
 * held in state — if it is, we skip `setMe` so reference equality is
 * preserved and downstream effects (notably the trial-expiry timer)
 * are not re-evaluated.
 *
 * The provider does not own a stable deep-equal utility, so this
 * compares every leaf field directly. Add a field here whenever the
 * CurrentMe contract gains one.
 */
function areCurrentMeEquivalent(a: CurrentMe | null, b: CurrentMe | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.user.id !== b.user.id) return false;
  if (a.user.email !== b.user.email) return false;
  if (a.user.displayName !== b.user.displayName) return false;
  if (a.user.householdSize !== b.user.householdSize) return false;
  if (a.user.cookingSkill !== b.user.cookingSkill) return false;
  if (a.account.id !== b.account.id) return false;
  if (a.account.type !== b.account.type) return false;
  if (a.account.trialEndsAt !== b.account.trialEndsAt) return false;
  if (a.account.subscriptionStatus !== b.account.subscriptionStatus) return false;
  if (a.account.access.canUseApp !== b.account.access.canUseApp) return false;
  if (a.account.access.reason !== b.account.access.reason) return false;
  if (a.membership.role !== b.membership.role) return false;
  if (a.onboarding.isComplete !== b.onboarding.isComplete) return false;
  return true;
}

/**
 * Maximum delay (in ms) we are willing to schedule a setTimeout for.
 * Node's setTimeout clamps any delay > 2^31-1 (~24.8 days) to ~1ms,
 * which is the root cause of the AuthProvider infinite loop when
 * `trialEndsAt` is far in the future: every `me` reference change
 * re-scheduled a 1ms timer that immediately fired and called
 * `refreshMe` again, ad infinitum.
 *
 * If the trial expires further out than this, we skip the timer
 * entirely — the next AppState activation, explicit refresh, or
 * session restore will pick the change up. 1 hour is a generous
 * upper bound: trial expirations that close should be rare and the
 * periodic refresh on app foreground is the primary mechanism.
 */
const MAX_TRIAL_EXPIRY_TIMER_DELAY_MS = 60 * 60 * 1000;

export function AuthProvider({ children }: AuthProviderProps) {
  const [me, setMe] = useState<CurrentMe | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Set to true when the local gate should treat the user as complete
  // even before the next /me snapshot confirms it. Used by
  // `completeOnboarding` to flip the gate optimistically after a
  // successful POST. Cleared when a fresh /me reports isComplete=false
  // (defensive — should not happen in practice because completion is
  // one-way on the server).
  const [optimisticComplete, setOptimisticComplete] = useState(false);
  const optimisticCompleteRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);
  // Mirror of the latest `me` state. Used by `applySession` to decide
  // whether to call `setMe` at all (avoids the React re-render
  // churn that produced the AuthProvider infinite loop).
  const meRef = useRef<CurrentMe | null>(null);
  // Tracks the trialEndsAt value for which refreshAndHandleFailure was
  // last invoked, so the effect does not re-fire on every `me` change
  // (server content-different refreshes would otherwise re-arm the
  // refresh in a tight loop).
  const lastTrialRefreshTrialEndsAt = useRef<string | null | undefined>(undefined);

  const applySession = useCallback((session: AuthSession | null) => {
    const nextMe = session?.me ?? null;
    // Skip setMe entirely when the snapshot is content-equal to the
    // current value. We use a ref (not a functional setState updater)
    // so we never schedule a re-render at all when the snapshot is
    // equivalent. Functional updaters still trigger a render
    // schedule; the parent component's useMemo and the context
    // consumer then re-evaluate even when React bails out at render.
    if (!areCurrentMeEquivalent(meRef.current, nextMe)) {
      meRef.current = nextMe;
      setMe(nextMe);
    }
    const nextAccessToken = session?.accessToken ?? null;
    if (accessTokenRef.current !== nextAccessToken) {
      setAccessToken(nextAccessToken);
      accessTokenRef.current = nextAccessToken;
    }
    const nextRefreshToken = session?.refreshToken ?? null;
    setRefreshToken((current) => (current === nextRefreshToken ? current : nextRefreshToken));
    // One-way latch: the optimistic-complete flag is set by
    // `completeOnboarding` and only clears when a fresh /me snapshot
    // confirms the server is in lockstep (me.onboarding.isComplete ===
    // true). A stale /me that still reports isComplete=false must NOT
    // clear the latch — the user has legally completed onboarding
    // server-side and the brief window where the server has not yet
    // propagated the completion must not bounce the gate back to
    // false. Logging out / losing the session always clears the flag
    // (no session means no pending completion).
    if (!session?.me) {
      setOptimisticComplete(false);
      optimisticCompleteRef.current = false;
      return;
    }
    if (session.me.onboarding?.isComplete === true) {
      setOptimisticComplete(false);
      optimisticCompleteRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const session = await authService.restoreSessionWithFreshMe();
        if (!cancelled) {
          applySession(session);
        }
      } catch (error) {
        console.warn('[AuthProvider] Error restaurando sesión:', error);
        await authService.clearSession();
        if (!cancelled) {
          applySession(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const signIn = useCallback(
    async (email: string, code: string) => {
      const session = await authService.verifyAndSignIn(email, code);
      applySession(session);
    },
    [applySession]
  );

  const signUp = useCallback(
    async (email: string, code: string) => {
      const session = await authService.verifyAndSignUp(email, code);
      applySession(session);
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    const tokenForLogout = accessToken;
    const refreshTokenForLogout = refreshToken;

    try {
      await authService.logout(tokenForLogout, refreshTokenForLogout);
    } catch (error) {
      console.warn('[AuthProvider] Error cerrando sesión remota:', error);
    } finally {
      await authService.clearSession();
      applySession(null);
      lastTrialRefreshTrialEndsAt.current = undefined;
    }
  }, [accessToken, refreshToken, applySession]);

  const refreshMe = useCallback(async () => {
    const session = await authService.refreshCurrentSession();
    applySession(session);
  }, [applySession]);

  const completeOnboarding = useCallback(
    async (payload: OnboardingCompletionRequest): Promise<OnboardingCompletionResponse> => {
      // Judgment Day C2: the POST result is the source of truth. The
      // follow-up refreshMe() is a soft read; if it fails the gate
      // must not flip the user back to the Onboarding screen because
      // the server already accepted the completion. The reconciliation
      // policy is unit-tested in `postCompletion.test.ts`.
      const result = await authService.completeOnboarding(payload);

      // The completion answer carries householdSize and cookingSkill,
      // which GET /api/me serves as null until the server stores them,
      // and onboarding completion does not yet. They go to the stored
      // snapshot before the refresh below, so neither the refreshed nor a
      // later restored /me drops them, and into `me` after it.
      const email = meRef.current?.user.email;
      const completedProfile: ProfileUpdateUser | null =
        email === undefined
          ? null
          : normalizeProfileFields({
              id: result.user.id,
              email,
              displayName: result.user.displayName,
              householdSize: result.user.householdSize,
              cookingSkill: result.user.cookingSkill,
            });
      if (completedProfile) {
        try {
          await authService.persistProfileForStoredSession(completedProfile);
        } catch (error) {
          console.warn('[AuthProvider] Error guardando el perfil del onboarding:', error);
        }
      }

      const session = await authService.persistOnboardingCompletionForStoredSession();
      if (session?.accessToken) {
        const reconcile = await reconcileAfterCompletion({
          wasComplete: optimisticCompleteRef.current,
          persisted: true,
          refresh: () => authService.refreshCurrentSession().then((next) => next ?? session),
          onOptimistic: (next) => {
            setOptimisticComplete(next);
            optimisticCompleteRef.current = next;
          },
          onRefreshed: (value) => {
            applySession(value);
          },
          shouldRetry: (error) => isTransientAuthError(error),
        });
        if (reconcile.outcome === 'refresh-failed') {
          console.warn(
            '[AuthProvider] Background /me refresh after onboarding failed; relying on next session restore.'
          );
        }
      } else {
        // No stored session: just flip the optimistic flag so the
        // gate moves; the next /api/me read will confirm.
        setOptimisticComplete(true);
        optimisticCompleteRef.current = true;
      }

      // Same patch as `updateProfile`: the POST answer is the source of
      // truth for the profile fields, whatever the refresh returned.
      const currentMe = meRef.current;
      if (completedProfile && currentMe && currentMe.user.id === completedProfile.id) {
        const nextMe = withUpdatedProfile(currentMe, completedProfile);
        if (!areCurrentMeEquivalent(currentMe, nextMe)) {
          meRef.current = nextMe;
          setMe(nextMe);
        }
      }

      return result;
    },
    [applySession]
  );

  const fetchUserPreferences = useCallback(async (): Promise<UserPreferences> => {
    return authService.getUserPreferences();
  }, []);

  const saveUserPreferences = useCallback(
    async (payload: UserPreferencesPayload): Promise<UserPreferences> => {
      return authService.updateUserPreferences(payload);
    },
    []
  );

  const fetchSlotCookingTimes = useCallback(async (): Promise<SlotCookingTimes> => {
    return authService.getSlotCookingTimes();
  }, []);

  const saveSlotCookingTimes = useCallback(
    async (payload: SlotCookingTimesPayload): Promise<SlotCookingTimes> => {
      return authService.updateSlotCookingTimes(payload);
    },
    []
  );

  const updateProfile = useCallback(
    async (payload: ProfileUpdatePayload): Promise<ProfileUpdateResponse> => {
      const result = await authService.updateProfile(payload);

      // The PUT response is the source of truth for the edited fields,
      // so `me` is patched from it instead of calling refreshMe(): a
      // refresh rotates the tokens and can fail after the save already
      // succeeded. The equivalence check keeps an unchanged profile
      // from scheduling a render, like `applySession` does.
      const currentMe = meRef.current;
      if (currentMe && currentMe.user.id === result.user.id) {
        const nextMe = withUpdatedProfile(currentMe, result.user);
        if (!areCurrentMeEquivalent(currentMe, nextMe)) {
          meRef.current = nextMe;
          setMe(nextMe);
        }
      }

      // Keeps an offline restart from showing the old profile. The
      // server already accepted the save, so a storage failure here
      // must not surface as a failed save.
      try {
        await authService.persistProfileForStoredSession(result.user);
      } catch (error) {
        console.warn('[AuthProvider] Error guardando el perfil en la sesión local:', error);
      }

      return result;
    },
    []
  );

  const handleRevalidationError = useCallback(
    async (error: unknown) => {
      if (authService.isTransientAuthError(error)) return;

      if (authService.isSessionInvalidAuthError(error)) {
        await authService.clearSession();
        applySession(null);
        return;
      }

      console.warn('[AuthProvider] Error revalidando sesión:', error);
    },
    [applySession]
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !accessTokenRef.current) return;

      refreshMe().catch(handleRevalidationError);
    });

    return () => subscription.remove();
  }, [handleRevalidationError, refreshMe]);

  useEffect(() => {
    // Depend on stable primitives (not the full `me` object) so this
    // effect does not re-run on every content-equal `me` reference
    // change. Re-running was the trigger for the runaway setTimeout
    // loop when the trial delay exceeded the 32-bit setTimeout max.
    const trialExpiryDelay = getTrialExpiryDelay(me);
    if (trialExpiryDelay === null) return;

    // Cap the scheduled delay to avoid the 32-bit setTimeout overflow
    // that would clamp a multi-year delay to ~1ms. If the trial is
    // further out than the cap, we let the next AppState activation
    // or explicit refresh pick it up.
    if (trialExpiryDelay > MAX_TRIAL_EXPIRY_TIMER_DELAY_MS) return;

    // Shared refresh-and-fallback handler for both the "expired now"
    // and "expire in the future" branches. On a transient failure
    // we optimistically flip the local access reason so the UI can
    // route to the TrialExpired screen before the server snapshot
    // catches up.
    const applyLocalTrialExpired = () => {
      setMe((currentMe) => {
        if (!currentMe) return currentMe;
        if (
          !currentMe.account.access.canUseApp &&
          currentMe.account.access.reason === 'trial_expired'
        ) {
          return currentMe;
        }
        const next = withLocalTrialExpired(currentMe);
        meRef.current = next;
        return next;
      });
    };

    const refreshAndHandleFailure = () => {
      refreshMe().catch((error) => {
        if (authService.isTransientAuthError(error)) {
          applyLocalTrialExpired();
          return;
        }

        handleRevalidationError(error);
      });
    };

    const refreshOnceForTrialEndsAt = () => {
      if (lastTrialRefreshTrialEndsAt.current === me?.account.trialEndsAt) return;
      lastTrialRefreshTrialEndsAt.current = me?.account.trialEndsAt;
      refreshAndHandleFailure();
    };

    // If the trial is already expired (delay <= 0), the server
    // snapshot in `me` is stale. Don't schedule a 0ms setTimeout
    // that would fire on the next tick and re-trigger the trial
    // effect — that was the runaway loop. Instead, fire the refresh
    // exactly once, asynchronously, and rely on the effect's stable
    // primitive deps to prevent the cycle.
    if (trialExpiryDelay <= 0) {
      applyLocalTrialExpired();
      refreshOnceForTrialEndsAt();
      return;
    }

    const timeout = setTimeout(() => {
      applyLocalTrialExpired();
      refreshOnceForTrialEndsAt();
    }, trialExpiryDelay);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handleRevalidationError,
    refreshMe,
    me?.account.trialEndsAt,
    me?.account.subscriptionStatus,
    me?.account.access.canUseApp,
    me?.account.access.reason,
  ]);

  const requestVerificationCode = useCallback((email: string, flow: AuthFlow) => {
    return authService.requestVerificationCode(email, flow);
  }, []);

  const sendVerificationCode = useCallback((email: string, flow: AuthFlow = 'login') => {
    return authService.sendVerificationCode(email, flow);
  }, []);

  const accessState = useMemo(() => getAccessState(me), [me]);

  // Keep meRef in sync with the latest `me` so future applySession
  // calls (which are stable callbacks) can compare against the
  // up-to-date value without re-creating the callback.
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  // isComplete is true if EITHER the server has confirmed it OR the
  // local optimistic flag is set (during the brief window between
  // POST success and the background refresh completion).
  const isComplete = optimisticComplete || (me?.onboarding.isComplete ?? false);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      user: me?.user ?? null,
      accessToken,
      refreshToken,
      token: accessToken,
      isLoading,
      isAuthenticated: hasCompleteSession(me, accessToken, refreshToken),
      ...accessState,
      isComplete,
      signIn,
      signUp,
      signOut,
      refreshMe,
      completeOnboarding,
      fetchUserPreferences,
      saveUserPreferences,
      fetchSlotCookingTimes,
      saveSlotCookingTimes,
      updateProfile,
      requestVerificationCode,
      sendVerificationCode,
    }),
    [
      me,
      accessToken,
      refreshToken,
      isLoading,
      accessState,
      isComplete,
      signIn,
      signUp,
      signOut,
      refreshMe,
      completeOnboarding,
      fetchUserPreferences,
      saveUserPreferences,
      fetchSlotCookingTimes,
      saveSlotCookingTimes,
      updateProfile,
      requestVerificationCode,
      sendVerificationCode,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
