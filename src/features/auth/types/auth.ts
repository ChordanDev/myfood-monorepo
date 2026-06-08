// Authentication types aligned with the Slice 1 backend contract.

export type AuthFlow = 'login' | 'register';

export type AuthErrorCode =
  | 'invalid_email'
  | 'email_already_exists'
  | 'email_not_found'
  | 'rate_limited'
  | 'code_invalid'
  | 'code_expired'
  | 'too_many_attempts'
  | 'unauthenticated'
  | 'access_token_expired'
  | 'refresh_token_invalid'
  | 'refresh_token_revoked'
  | 'refresh_token_replayed'
  | 'refresh_token_expired'
  | 'refresh_token_session_mismatch'
  | 'trial_expired'
  | 'configuration_error'
  | 'network_error'
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

export interface AuthAccount {
  id: string;
  type: 'individual' | string;
  trialEndsAt: string | null;
  subscriptionStatus: 'none' | 'active' | 'past_due' | 'canceled' | string;
  access: AuthAccountAccess;
}

export interface AuthMembership {
  role: 'owner' | string;
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
  tokenType: 'Bearer' | string;
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
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, code: string) => Promise<void>;
  signUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  requestVerificationCode: (email: string, flow: AuthFlow) => Promise<CodeRequestResponse>;
  /** Backwards-compatible helper; defaults to login when no flow is supplied. */
  sendVerificationCode: (email: string, flow?: AuthFlow) => Promise<CodeRequestResponse>;
}
