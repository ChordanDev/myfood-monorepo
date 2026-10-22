// Authentication types aligned with the Slice 1 backend contract.

import type { MealSlot } from '@/types/domain';

export type AuthFlow = 'login' | 'register';

/** Identity providers `POST /api/auth/social` accepts. */
export type SocialProvider = 'google' | 'apple';

export type CookingSkill = 'beginner' | 'intermediate' | 'advanced';

export type HungerLevel = 'light' | 'normal' | 'strong';

// The meal slots the User cooks: every Meal slot carries a Slot cooking time.
export type CookingTimeSlot = MealSlot;

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

export type SlotCookingTimesPayload = Record<CookingTimeSlot, SlotCookingTime>;

export type SlotCookingTimes = SlotCookingTimesPayload;

export interface OnboardingCompletionRequest {
  profile: OnboardingProfile;
  preferences: UserPreferencesPayload;
  slotCookingTimes: SlotCookingTimesPayload;
  /** IANA zone name of the device, stored on the Account. */
  timezone: string;
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

// Post-onboarding profile edit. Same fields and validation as the
// onboarding profile step.
export type ProfileUpdatePayload = OnboardingProfile;

// The profile fields are nullable like on AuthUser: the client fills a
// field the server answer omits with null instead of trusting it.
export interface ProfileUpdateUser {
  id: string;
  email: string;
  displayName: string | null;
  householdSize: number | null;
  cookingSkill: CookingSkill | null;
}

export interface AccountTimezonePayload {
  timezone: string;
}

export interface AccountTimezoneResponse {
  account: { id: string; timezone: string | null };
}

/** The Account's weekly Budget, as `GET` and `PUT /api/account/budget` answer it. */
export interface AccountBudget {
  weeklyBudgetCents: number;
  /** True while the Account never set a Budget and the tier default applies. */
  isDefault: boolean;
  /** The least amount the owner may set. */
  minWeeklyBudgetCents: number;
  currency: string;
}

export interface AccountBudgetPayload {
  weeklyBudgetCents: number;
}

export interface AccountBudgetResponse {
  budget: AccountBudget;
}

export interface ProfileUpdateResponse {
  user: ProfileUpdateUser;
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
  | 'social_token_invalid'
  | 'social_email_unverified'
  | 'social_provider_unsupported'
  | 'unauthenticated'
  | 'access_token_expired'
  | 'refresh_token_invalid'
  | 'refresh_token_revoked'
  | 'refresh_token_replayed'
  | 'refresh_token_expired'
  | 'refresh_token_session_mismatch'
  | 'account_not_found'
  | 'trial_expired'
  | 'validation_error'
  | 'invalid_cooking_skill'
  | 'slot_cooking_times_not_found'
  | 'invalid_hunger_level'
  | 'invalid_diet'
  | 'invalid_hard_restriction'
  | 'inventory_item_not_found'
  | 'shopping_item_not_manual'
  | 'shopping_item_not_found'
  | 'shopping_item_not_planned'
  | 'shopping_item_in_cart'
  | 'voice_parse_failed'
  | 'voice_confirmation_required'
  | 'generation_in_progress'
  | 'no_active_generation'
  | 'missing_session_id'
  | 'account_expired'
  | 'invalid_proposal_id'
  | 'not_found'
  | 'subscription_required'
  | 'invalid_range'
  | 'overlapping_range'
  | 'planning_invalid_range'
  | 'planning_date_range_too_long'
  | 'planning_range_locked'
  | 'planning_slot_occupied'
  | 'planning_proposal_not_pending'
  | 'forbidden_intent'
  | 'unknown_intent'
  | 'invalid_payload'
  | 'session_mismatch'
  | 'no_active_session'
  | 'forbidden'
  | 'already_confirmed'
  | 'foreign_lock'
  | 'not_a_member'
  | 'missing_lock'
  | 'lost_lock'
  | 'terminal_lock'
  | 'transaction_failed'
  | 'already_active'
  | 'invalid_identity'
  | 'invalid_date'
  | 'invalid_date_range'
  | 'date_range_too_long'
  | 'optimization_failed'
  | 'optimizer_unavailable'
  | 'optimizer_timeout'
  | 'planning_session_invalid_range'
  | 'consent_required'
  | 'agent_busy'
  | 'agent_unavailable'
  | 'stale_proposal'
  | 'approval_required'
  | 'proposal_invalid'
  | 'confirmation_unresolved'
  | 'recipe_not_found'
  | 'cart_locked'
  | 'stale_cart'
  | 'cart_not_found'
  | 'checkout_invalid_type'
  | 'cart_expired'
  | 'checkout_session_not_found'
  | 'scheduled_meal_not_found'
  | 'cooking_session_not_active'
  | 'cooking_already_finished'
  | 'cooking_chat_unavailable'
  | 'cooking_chat_limit_reached'
  | 'cooking_message_id_conflict'
  | 'inventory_mutation_failed'
  | 'prepared_leftover_not_found'
  | 'scheduled_meal_cooked'
  | 'calendar_conflict'
  | 'calendar_move_not_possible'
  | 'calendar_meal_cooking_in_progress'
  | 'meal_already_confirmed'
  | 'confirmation_window_closed'
  | 'not_owner'
  | 'configuration_error'
  | 'network_error'
  | 'timeout'
  | 'unknown_error';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  /** Null until the user sets it. */
  householdSize: number | null;
  /** Null until the user sets it. */
  cookingSkill: CookingSkill | null;
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
 * Closed union for `membership.role` in the `CurrentMe` payload.
 *
 * Source of truth:
 * `MealPlannerApi.Persistence.Accounts.AccountMembership`
 * (`apps/api/lib/meal_planner_api/persistence/accounts/account_membership.ex`),
 * whose `role` field is an `Ecto.Enum` with values `[:owner, :member]`
 * and whose `changeset/2` validates `role` against the same list.
 * `MealPlannerApiWeb.CurrentMe.build/4` renders the atom as a string.
 * Adding a role on the api MUST be paired with an update here.
 */
export type AuthMembershipRole = 'owner' | 'member';

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
  // IANA zone the Account's "today" follows; null until the app first sends one.
  timezone: string | null;
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
  /** Signs in (or up) with the identity token an identity provider SDK returned. */
  signInWithSocial: (provider: SocialProvider, idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  completeOnboarding: (
    payload: OnboardingCompletionRequest
  ) => Promise<OnboardingCompletionResponse>;
  fetchUserPreferences: () => Promise<UserPreferences>;
  saveUserPreferences: (payload: UserPreferencesPayload) => Promise<UserPreferences>;
  fetchSlotCookingTimes: () => Promise<SlotCookingTimes>;
  saveSlotCookingTimes: (payload: SlotCookingTimesPayload) => Promise<SlotCookingTimes>;
  /** Saves the editable profile fields and reflects them on `me`. */
  updateProfile: (payload: ProfileUpdatePayload) => Promise<ProfileUpdateResponse>;
  requestVerificationCode: (email: string, flow: AuthFlow) => Promise<CodeRequestResponse>;
  /** Backwards-compatible helper; defaults to login when no flow is supplied. */
  sendVerificationCode: (email: string, flow?: AuthFlow) => Promise<CodeRequestResponse>;
}
