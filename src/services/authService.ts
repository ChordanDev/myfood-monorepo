import * as SecureStore from 'expo-secure-store';
import type {
  AuthErrorCode,
  AuthFlow,
  AuthSession,
  CodeRequestResponse,
  CurrentMe,
  StoredAuthSession,
} from '@/features/auth/types/auth';

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const ME_KEY = 'auth_me';
const DEVICE_ID_KEY = 'auth_device_id';

const KNOWN_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'invalid_email',
  'email_already_exists',
  'email_not_found',
  'rate_limited',
  'code_invalid',
  'code_expired',
  'too_many_attempts',
  'unauthenticated',
  'access_token_expired',
  'refresh_token_invalid',
  'refresh_token_revoked',
  'refresh_token_replayed',
  'refresh_token_expired',
  'refresh_token_session_mismatch',
  'trial_expired',
  'configuration_error',
  'network_error',
  'unknown_error',
]);

const REFRESHABLE_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'unauthenticated',
  'access_token_expired',
]);

const SESSION_INVALID_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
  'refresh_token_invalid',
  'refresh_token_revoked',
  'refresh_token_replayed',
  'refresh_token_expired',
]);

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer' | string;
}

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

export function getAuthErrorMessage(error: unknown): string {
  if (!isAuthApiError(error)) {
    return 'Ocurrió un error inesperado. Intenta nuevamente.';
  }

  switch (error.code) {
    case 'invalid_email':
      return 'El email ingresado no es válido.';
    case 'email_already_exists':
      return 'Ese email ya tiene una cuenta. Iniciá sesión para continuar.';
    case 'email_not_found':
      return 'No encontramos una cuenta con ese email. Creá una cuenta para continuar.';
    case 'rate_limited':
      return 'Hiciste demasiados intentos. Esperá un momento y volvé a probar.';
    case 'code_invalid':
      return 'El código ingresado no es válido.';
    case 'code_expired':
      return 'El código expiró. Pedí uno nuevo para continuar.';
    case 'too_many_attempts':
      return 'Se agotaron los intentos para este código. Pedí uno nuevo.';
    case 'unauthenticated':
    case 'access_token_expired':
      return 'Tu sesión expiró. Iniciá sesión nuevamente.';
    case 'refresh_token_invalid':
    case 'refresh_token_revoked':
    case 'refresh_token_replayed':
    case 'refresh_token_expired':
      return 'No pudimos renovar tu sesión. Iniciá sesión nuevamente.';
    case 'refresh_token_session_mismatch':
      return 'No pudimos cerrar la sesión de forma remota, pero se cerró en este dispositivo.';
    case 'trial_expired':
      return 'Tu período de prueba terminó.';
    case 'configuration_error':
      return 'Falta configurar EXPO_PUBLIC_API_URL para conectar con la API.';
    case 'network_error':
      return 'No pudimos conectar con el servidor. Revisá tu conexión.';
    default:
      return error.message || 'Ocurrió un error inesperado. Intenta nuevamente.';
  }
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
  accessToken?: string | null
): Promise<T> {
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
    });
  } catch (error) {
    if (isAuthApiError(error)) throw error;
    throw new AuthApiError('network_error', 'Network request failed');
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw errorFromEnvelope(payload, response.status);
  }

  return payload as T;
}

async function postJson<T>(path: string, body: unknown, accessToken?: string | null): Promise<T> {
  return apiRequest<T>(
    path,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    accessToken
  );
}

async function getDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  const randomId = `expo-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await SecureStore.setItemAsync(DEVICE_ID_KEY, randomId);
  return randomId;
}

function endpointForRequest(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/request-code' : '/api/auth/login/request-code';
}

function endpointForVerify(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/verify-code' : '/api/auth/login/verify-code';
}

export async function persistSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
  await SecureStore.setItemAsync(ME_KEY, JSON.stringify(session.me));
}

async function persistTokens(tokens: RefreshResponse): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export async function requestVerificationCode(
  email: string,
  flow: AuthFlow
): Promise<CodeRequestResponse> {
  return postJson<CodeRequestResponse>(endpointForRequest(flow), { email });
}

/** Backwards-compatible helper for older UI call sites. */
export async function sendVerificationCode(
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

export async function getMe(accessToken: string): Promise<CurrentMe> {
  return apiRequest<CurrentMe>('/api/me', { method: 'GET' }, accessToken);
}

export async function refreshTokens(refreshToken: string): Promise<RefreshResponse> {
  const tokens = await postJson<RefreshResponse>('/api/auth/refresh', { refreshToken });
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
  const [accessToken, refreshToken, meJson] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    SecureStore.getItemAsync(ME_KEY),
  ]);

  if (!accessToken || !refreshToken || !meJson) {
    return null;
  }

  try {
    const me = JSON.parse(meJson) as CurrentMe;
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
  return isAuthApiError(error) && error.code === 'network_error';
}

export async function restoreSessionWithFreshMe(): Promise<AuthSession | null> {
  const storedSession = await getStoredSession();
  if (!storedSession) return null;

  try {
    const me = await getMe(storedSession.accessToken);
    const freshSession = { ...storedSession, me };
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
    const refreshedSession: AuthSession = { ...tokens, me };
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
  const session: AuthSession = { ...tokens, me };
  await persistSession(session);
  return session;
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(ME_KEY);
}
