import type {
  AuthErrorCode,
  AuthFlow,
  AuthSession,
  CodeRequestResponse,
  CurrentMe,
  OnboardingCompletionRequest,
  OnboardingCompletionResponse,
  SlotCookingTimes,
  SlotCookingTimesPayload,
  StoredAuthSession,
  UserPreferences,
  UserPreferencesPayload,
} from '@/features/auth/types/auth';
import { secureStorage } from './secureStorage';

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const ME_KEY = 'auth_me';
const ONBOARDING_COMPLETED_USER_ID_KEY = 'auth_onboarding_completed_user_id';
const DEVICE_ID_KEY = 'auth_device_id';

/** Default per-request timeout for normal API calls (15s). */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** Per-request timeout for the refresh endpoint — longer to absorb slow cold refreshes (30s). */
export const REFRESH_REQUEST_TIMEOUT_MS = 30_000;

const KNOWN_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'invalid_email',
  'email_already_exists',
  'email_not_found',
  'rate_limited',
  'code_invalid',
  'code_expired',
  'code_send_failed',
  'too_many_attempts',
  'unauthenticated',
  'access_token_expired',
  'refresh_token_invalid',
  'refresh_token_revoked',
  'refresh_token_replayed',
  'refresh_token_expired',
  'refresh_token_session_mismatch',
  'account_not_found',
  'rate_limit_record_failed',
  'trial_expired',
  'onboarding_invalid',
  'onboarding_already_complete',
  'preferences_invalid',
  'slot_cooking_times_invalid',
  'configuration_error',
  'network_error',
  'timeout',
  'unknown_error',
]);

const REFRESHABLE_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'unauthenticated',
  'access_token_expired',
]);

const TRANSIENT_AUTH_ERROR_CODES = new Set<AuthErrorCode>(['network_error', 'timeout']);

const SESSION_INVALID_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'refresh_token_invalid',
  'refresh_token_revoked',
  'refresh_token_replayed',
  'refresh_token_expired',
  'refresh_token_session_mismatch',
]);

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Shape of the `/api/auth/refresh` response. The token_type field is
 * derived from the canonical `AuthTokenType` union in `types/auth.ts`
 * so the back can never emit an unknown token type silently.
 */
type RefreshResponse = Pick<AuthSession, 'accessToken' | 'refreshToken' | 'tokenType'>;

export class AuthApiError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly status: number = 0
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

export function isAuthApiError(error: unknown): error is AuthApiError {
  return error instanceof AuthApiError;
}

const AUTH_ERROR_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
  invalid_email: 'El email ingresado no es válido.',
  email_already_exists: 'Ese email ya tiene una cuenta. Iniciá sesión para continuar.',
  email_not_found: 'No encontramos una cuenta con ese email. Creá una cuenta para continuar.',
  rate_limited: 'Hiciste demasiados intentos. Esperá un momento y volvé a probar.',
  code_invalid: 'El código ingresado no es válido.',
  code_expired: 'El código expiró. Pedí uno nuevo para continuar.',
  code_send_failed: 'No pudimos enviar el código por email. Probá de nuevo en un momento.',
  too_many_attempts: 'Se agotaron los intentos para este código. Pedí uno nuevo.',
  unauthenticated: 'Tu sesión expiró. Iniciá sesión nuevamente.',
  access_token_expired: 'Tu sesión expiró. Iniciá sesión nuevamente.',
  refresh_token_invalid: 'No pudimos renovar tu sesión. Iniciá sesión nuevamente.',
  refresh_token_revoked: 'No pudimos renovar tu sesión. Iniciá sesión nuevamente.',
  refresh_token_replayed: 'No pudimos renovar tu sesión. Iniciá sesión nuevamente.',
  refresh_token_expired: 'No pudimos renovar tu sesión. Iniciá sesión nuevamente.',
  refresh_token_session_mismatch:
    'No pudimos cerrar la sesión de forma remota, pero se cerró en este dispositivo.',
  account_not_found: 'No pudimos encontrar tu cuenta. Iniciá sesión nuevamente.',
  rate_limit_record_failed: 'Hubo un problema al registrar tu actividad. Intenta nuevamente.',
  trial_expired: 'Tu período de prueba terminó.',
  onboarding_invalid: 'Los datos de configuración no son válidos. Revisá el formulario.',
  onboarding_already_complete: 'Ya completaste la configuración inicial.',
  preferences_invalid: 'Tus preferencias no son válidas. Revisá los valores ingresados.',
  slot_cooking_times_invalid:
    'Los tiempos de cocina no son válidos. Revisá los valores ingresados.',
  configuration_error: 'Falta configurar EXPO_PUBLIC_API_URL para conectar con la API.',
  network_error: 'No pudimos conectar con el servidor. Revisá tu conexión.',
  timeout: 'La conexión tardó demasiado. Revisá tu señal e intentá nuevamente.',
  unknown_error: 'Ocurrió un error inesperado. Intenta nuevamente.',
};

export function getAuthErrorMessage(error: unknown): string {
  if (!isAuthApiError(error)) {
    return 'Ocurrió un error inesperado. Intenta nuevamente.';
  }

  return (
    AUTH_ERROR_MESSAGES[error.code] ??
    error.message ??
    'Ocurrió un error inesperado. Intenta nuevamente.'
  );
}

function getApiBaseUrl(): string {
  const rawUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

  if (!rawUrl) {
    throw new AuthApiError(
      'configuration_error',
      'EXPO_PUBLIC_API_URL is required to connect to the backend API.'
    );
  }

  return rawUrl.replace(/\/+$/, '');
}

function buildApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFromEnvelope(payload: unknown, status: number): AuthApiError {
  const envelope = payload as ErrorEnvelope | null;
  const rawCode = envelope?.error?.code;
  const code = KNOWN_AUTH_ERROR_CODES.has(rawCode as AuthErrorCode)
    ? (rawCode as AuthErrorCode)
    : 'unknown_error';
  const message =
    code === 'unknown_error' ? 'Request failed' : (envelope?.error?.message ?? 'Request failed');
  return new AuthApiError(code, message, status);
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  retry: boolean = false
): Promise<T> {
  const execute = async (): Promise<T> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;

    try {
      response = await fetch(buildApiUrl(path), {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (isAuthApiError(error)) throw error;
      if (isAbortError(error)) {
        throw new AuthApiError('timeout', 'Request timeout', 0);
      }
      throw new AuthApiError('network_error', 'Network request failed');
    } finally {
      clearTimeout(timeoutHandle);
    }

    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw errorFromEnvelope(payload, response.status);
    }

    return payload as T;
  };

  try {
    return await execute();
  } catch (error) {
    if (retry && isTransientAuthError(error)) {
      return execute();
    }
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

async function postJson<T>(
  path: string,
  body: unknown,
  accessToken?: string | null,
  timeoutMs?: number,
  retry: boolean = false
): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    accessToken,
    timeoutMs,
    retry
  );
}

export async function getDeviceId(): Promise<string> {
  const existing = await secureStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const randomId = globalThis.crypto.randomUUID();
  await secureStorage.setItem(DEVICE_ID_KEY, randomId);
  return randomId;
}

function endpointForRequest(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/request-code' : '/api/auth/login/request-code';
}

function endpointForVerify(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/verify-code' : '/api/auth/login/verify-code';
}

function withLocalOnboardingCompletion(me: CurrentMe, completedUserId: string | null): CurrentMe {
  if (completedUserId !== me.user.id) return me;
  return {
    ...me,
    onboarding: { ...me.onboarding, isComplete: true },
  };
}

export async function persistSession(session: AuthSession): Promise<void> {
  const completedUserId = await secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  const shouldPersistLocalCompletion = session.me.onboarding.isComplete;
  const shouldApplyLocalCompletion = completedUserId === session.me.user.id;
  const me = withLocalOnboardingCompletion(session.me, completedUserId);

  await secureStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
  await secureStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  await secureStorage.setItem(ME_KEY, JSON.stringify(me));

  if (shouldPersistLocalCompletion || shouldApplyLocalCompletion) {
    await secureStorage.setItem(ONBOARDING_COMPLETED_USER_ID_KEY, session.me.user.id);
  } else if (completedUserId && completedUserId !== session.me.user.id) {
    await secureStorage.deleteItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  }
}

export async function persistOnboardingCompletionForStoredSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  const completedSession: StoredAuthSession = {
    ...storedSession,
    me: {
      ...storedSession.me,
      onboarding: { ...storedSession.me.onboarding, isComplete: true },
    },
  };
  await secureStorage.setItem(ONBOARDING_COMPLETED_USER_ID_KEY, storedSession.me.user.id);
  await persistSession(completedSession);
  return completedSession;
}

async function persistTokens(tokens: RefreshResponse): Promise<void> {
  await secureStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  await secureStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export async function requestVerificationCode(
  email: string,
  flow: AuthFlow
): Promise<CodeRequestResponse> {
  return postJson<CodeRequestResponse>(endpointForRequest(flow), { email });
}

/** Backwards-compatible helper for older UI call sites. */
export function sendVerificationCode(
  email: string,
  flow: AuthFlow = 'login'
): Promise<CodeRequestResponse> {
  return requestVerificationCode(email, flow);
}

export async function verifyCode(
  email: string,
  code: string,
  flow: AuthFlow
): Promise<AuthSession> {
  const deviceId = await getDeviceId();
  const session = await postJson<AuthSession>(endpointForVerify(flow), { email, code, deviceId });
  await persistSession(session);
  return session;
}

export async function verifyAndSignIn(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'login');
}

export async function verifyAndSignUp(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'register');
}

/** Optional overrides for per-call request behavior. */
export interface RequestOptions {
  /** Timeout in ms. Defaults to 15s for normal calls and 30s for refresh. */
  timeoutMs?: number;
  /**
   * Retry once on transient errors (network_error or timeout). MUST only be true
   * for idempotent endpoints (GETs and refresh). Defaults to false.
   */
  retry?: boolean;
}

export async function getMe(accessToken: string, options?: RequestOptions): Promise<CurrentMe> {
  return apiRequest<CurrentMe>(
    '/api/me',
    { method: 'GET' },
    accessToken,
    options?.timeoutMs,
    options?.retry ?? true
  );
}

export async function completeOnboarding(
  accessToken: string,
  payload: OnboardingCompletionRequest
): Promise<OnboardingCompletionResponse> {
  return postJson<OnboardingCompletionResponse>('/api/onboarding/complete', payload, accessToken);
}

export async function getUserPreferences(
  accessToken: string,
  options?: RequestOptions
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>(
    '/api/me/preferences',
    { method: 'GET' },
    accessToken,
    options?.timeoutMs,
    options?.retry ?? true
  );
}

export async function updateUserPreferences(
  accessToken: string,
  payload: UserPreferencesPayload
): Promise<UserPreferences> {
  return apiRequest<UserPreferences>(
    '/api/me/preferences',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    accessToken
  );
}

export async function getSlotCookingTimes(
  accessToken: string,
  options?: RequestOptions
): Promise<SlotCookingTimes> {
  return apiRequest<SlotCookingTimes>(
    '/api/me/slot-cooking-times',
    { method: 'GET' },
    accessToken,
    options?.timeoutMs,
    options?.retry ?? true
  );
}

export async function updateSlotCookingTimes(
  accessToken: string,
  payload: SlotCookingTimesPayload
): Promise<SlotCookingTimes> {
  return apiRequest<SlotCookingTimes>(
    '/api/me/slot-cooking-times',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    accessToken
  );
}

/**
 * Refresh the access/refresh token pair.
 *
 * Trade-off (acknowledged by 4R review): the back rotates refresh tokens on
 * every successful /auth/refresh. If the first request succeeds server-side
 * (rotates the token) but the response is lost to a network blip, the retry
 * uses the now-stale refresh token. The back rejects it as
 * `refresh_token_invalid`, and `restoreSessionWithFreshMe` clears the local
 * session. The user is silently signed out.
 *
 * This is a known and accepted trade-off. The alternative (no retry on
 * refresh) would mean a single dropped packet always forces re-login.
 */
export async function refreshTokens(refreshToken: string): Promise<RefreshResponse> {
  const tokens = await postJson<RefreshResponse>(
    '/api/auth/refresh',
    { refreshToken },
    undefined,
    REFRESH_REQUEST_TIMEOUT_MS,
    true
  );
  await persistTokens(tokens);
  return tokens;
}

export async function logout(
  accessToken: string | null,
  refreshToken?: string | null
): Promise<void> {
  if (!accessToken) return;

  await apiRequest<null>(
    '/api/auth/logout',
    {
      method: 'POST',
      ...(refreshToken ? { body: JSON.stringify({ refreshToken }) } : {}),
    },
    accessToken
  );
}

export async function getStoredSession(): Promise<StoredAuthSession | null> {
  const [accessToken, refreshToken, meJson, completedUserId] = await Promise.all([
    secureStorage.getItem(ACCESS_TOKEN_KEY),
    secureStorage.getItem(REFRESH_TOKEN_KEY),
    secureStorage.getItem(ME_KEY),
    secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY),
  ]);

  if (!accessToken || !refreshToken || !meJson) {
    return null;
  }

  try {
    const parsedMe = JSON.parse(meJson) as CurrentMe;
    const me = withLocalOnboardingCompletion(parsedMe, completedUserId);
    return { accessToken, refreshToken, tokenType: 'Bearer', me };
  } catch {
    await clearSession();
    return null;
  }
}

export function isRefreshableAuthError(error: unknown): boolean {
  return isAuthApiError(error) && REFRESHABLE_AUTH_ERROR_CODES.has(error.code);
}

export function isSessionInvalidAuthError(error: unknown): boolean {
  return isAuthApiError(error) && SESSION_INVALID_AUTH_ERROR_CODES.has(error.code);
}

export function isTransientAuthError(error: unknown): boolean {
  return isAuthApiError(error) && TRANSIENT_AUTH_ERROR_CODES.has(error.code);
}

export async function restoreSessionWithFreshMe(): Promise<AuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  try {
    const me = await getMe(storedSession.accessToken);
    const completedUserId = await secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
    const freshSession = {
      ...storedSession,
      me: withLocalOnboardingCompletion(me, completedUserId),
    };
    await persistSession(freshSession);
    return freshSession;
  } catch (error) {
    if (isTransientAuthError(error)) {
      return storedSession;
    }

    if (!isRefreshableAuthError(error)) {
      throw error;
    }
  }

  try {
    const tokens = await refreshTokens(storedSession.refreshToken);
    const me = await getMe(tokens.accessToken);
    const completedUserId = await secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
    const refreshedSession: AuthSession = {
      ...tokens,
      me: withLocalOnboardingCompletion(me, completedUserId),
    };
    await persistSession(refreshedSession);
    return refreshedSession;
  } catch (error) {
    if (isTransientAuthError(error)) {
      return storedSession;
    }

    if (isSessionInvalidAuthError(error)) {
      await clearSession();
      return null;
    }

    throw error;
  }
}

export async function refreshCurrentSession(): Promise<AuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  const tokens = await refreshTokens(storedSession.refreshToken);
  const me = await getMe(tokens.accessToken);
  const completedUserId = await secureStorage.getItem(ONBOARDING_COMPLETED_USER_ID_KEY);
  const session: AuthSession = {
    ...tokens,
    me: withLocalOnboardingCompletion(me, completedUserId),
  };
  await persistSession(session);
  return session;
}

export async function clearSession(): Promise<void> {
  await secureStorage.deleteItem(ACCESS_TOKEN_KEY);
  await secureStorage.deleteItem(REFRESH_TOKEN_KEY);
  await secureStorage.deleteItem(ME_KEY);
  await secureStorage.deleteItem(ONBOARDING_COMPLETED_USER_ID_KEY);
}
