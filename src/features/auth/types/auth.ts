// Authentication types aligned with the Slice 1 backend contract.

export type AuthFlow = 'login' | 'register';

export type CookingSkill = 'beginner' | 'intermediate' | 'advanced';

export type HungerLevel = 'light' | 'normal' | 'strong';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export const SUPPORTED_MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'] as const;

export interface OnboardingProfile {
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
}

export interface UserPreferencesPayload {
  diet: string | null;
  hardRestrictions: string[];
  softPreferences: string[];
}

export type UserPreferences = UserPreferencesPayload;

export interface SlotCookingTime {
  cookingTimeMinutes: number;
  hungerLevel: HungerLevel;
}

export type SlotCookingTimesPayload = Record<MealSlot, SlotCookingTime>;

export type SlotCookingTimes = SlotCookingTimesPayload;

export interface OnboardingCompletionRequest {
  profile: OnboardingProfile;
  preferences: UserPreferencesPayload;
  slotCookingTimes: SlotCookingTimesPayload;
}

export interface OnboardingCompletionUser {
  id: string;
  displayName: string;
  householdSize: number;
  cookingSkill: CookingSkill;
  onboardingCompletedAt: string | null;
}

export interface OnboardingCompletionResponse {
  user: OnboardingCompletionUser;
  preferences: UserPreferences;
  slotCookingTimes: SlotCookingTimes;
}

export type AuthErrorCode =
  | 'invalid_email'
  | 'email_already_exists'
  | 'email_not_found'
  | 'rate_limited'
  | 'code_invalid'
  | 'code_expired'
  | 'code_send_failed'
  | 'too_many_attempts'
  | 'unauthenticated'
  | 'access_token_expired'
  | 'refresh_token_invalid'
  | 'refresh_token_revoked'
  | 'refresh_token_replayed'
  | 'refresh_token_expired'
  | 'refresh_token_session_mismatch'
  | 'account_not_found'
  | 'rate_limit_record_failed'
  | 'trial_expired'
  | 'onboarding_invalid'
  | 'onboarding_already_complete'
  | 'preferences_invalid'
  | 'slot_cooking_times_invalid'
  | 'configuration_error'
  | 'network_error'
  | 'timeout'
  | 'unknown_error';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface AuthAccountAccess {
  canUseApp: boolean;
  reason: string | null;
}

/**
 * Closed union for `accounts.type`.
 *
 * Source of truth: `MyFoodBack.Accounts.Account.changeset/2`
 * (`my_food_back/lib/my_food_back/accounts/account.ex`), which validates
 * `type` against `["individual", "family", "family_plus"]`. Adding a new
 * value on the back MUST be paired with an update here.
 */
export type AuthAccountType = 'individual' | 'family' | 'family_plus';

/**
 * Closed union for `accounts.subscription_status`.
 *
 * Source of truth: `MyFoodBack.Accounts.Account.changeset/2`, which
 * validates against `["none", "active", "past_due", "canceled"]`.
 */
export type AuthSubscriptionStatus = 'none' | 'active' | 'past_due' | 'canceled';

/**
 * Closed union for `memberships.role`.
 *
 * Source of truth: `MyFoodBack.Accounts.Membership.changeset/2`, which
 * validates `role` against `["owner"]`.
 */
export type AuthMembershipRole = 'owner';

/**
 * Closed union for OAuth-style `token_type`.
 *
 * Source of truth: `MyFoodBack.Auth.auth_response/6` and
 * `token_response/3` in `my_food_back/lib/my_food_back/auth.ex`, both of
 * which hard-code `"Bearer"`.
 */
export type AuthTokenType = 'Bearer';

export interface AuthAccount {
  id: string;
  type: AuthAccountType;
  trialEndsAt: string | null;
  subscriptionStatus: AuthSubscriptionStatus;
  access: AuthAccountAccess;
}

export interface AuthMembership {
  role: AuthMembershipRole;
}

export interface AuthOnboarding {
  isComplete: boolean;
}

export interface CurrentMe {
  user: AuthUser;
  account: AuthAccount;
  membership: AuthMembership;
  onboarding: AuthOnboarding;
}

export interface CodeRequestResponse {
  status: 'code_sent';
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  tokenType: AuthTokenType;
  me: CurrentMe;
}

export type StoredAuthSession = AuthSession;

export interface AuthState {
  /** Current /api/me snapshot, or null if there is no restored session. */
  me: CurrentMe | null;
  /** Convenience shortcut for me.user. */
  user: AuthUser | null;
  /** Short-lived access token for the active session. */
  accessToken: string | null;
  /** Long-lived rotating refresh token for the active session. */
  refreshToken: string | null;
  /** Backwards-compatible alias for accessToken. */
  token: string | null;
  /** True while restoring/refreshing the session on app start. */
  isLoading: boolean;
  /** True when a session exists, including locked trial-expired accounts. */
  isAuthenticated: boolean;
  /** Primary app gate from me.account.access.canUseApp. */
  canUseApp: boolean;
  /** Stable lock reason from me.account.access.reason. */
  accessReason: string | null;
  /** Convenience flag for the Slice 1 trial-expired gate. */
  isTrialExpired: boolean;
  /** Slice 2 onboarding flag derived from me.onboarding.isComplete. */
  isComplete: boolean;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, code: string) => Promise<void>;
  signUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  completeOnboarding: (
    payload: OnboardingCompletionRequest
  ) => Promise<OnboardingCompletionResponse>;
  fetchUserPreferences: () => Promise<UserPreferences>;
  saveUserPreferences: (payload: UserPreferencesPayload) => Promise<UserPreferences>;
  fetchSlotCookingTimes: () => Promise<SlotCookingTimes>;
  saveSlotCookingTimes: (payload: SlotCookingTimesPayload) => Promise<SlotCookingTimes>;
  requestVerificationCode: (email: string, flow: AuthFlow) => Promise<CodeRequestResponse>;
  /** Backwards-compatible helper; defaults to login when no flow is supplied. */
  sendVerificationCode: (email: string, flow?: AuthFlow) => Promise<CodeRequestResponse>;
}
