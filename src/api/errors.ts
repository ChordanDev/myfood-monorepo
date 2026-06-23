import type { AuthErrorCode } from '@/features/auth/types/auth';

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export const KNOWN_AUTH_ERROR_CODES = new Set<AuthErrorCode>([
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

export const AUTH_ERROR_MESSAGES: Partial<Record<AuthErrorCode, string>> = {
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

export class ApiError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly status: number = 0
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

export const AuthApiError = ApiError;

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAuthApiError(error: unknown): error is ApiError {
  return isApiError(error);
}

export function getAuthErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Ocurrió un error inesperado. Intenta nuevamente.';
  }

  return (
    AUTH_ERROR_MESSAGES[error.code] ??
    error.message ??
    'Ocurrió un error inesperado. Intenta nuevamente.'
  );
}

export function errorFromEnvelope(payload: unknown, status: number): ApiError {
  const envelope = payload as ErrorEnvelope | null;
  const rawCode = envelope?.error?.code;
  const code = KNOWN_AUTH_ERROR_CODES.has(rawCode as AuthErrorCode)
    ? (rawCode as AuthErrorCode)
    : 'unknown_error';
  const message =
    code === 'unknown_error' ? 'Request failed' : (envelope?.error?.message ?? 'Request failed');
  return new ApiError(code, message, status);
}

export function isRefreshableAuthError(error: unknown): boolean {
  return isApiError(error) && REFRESHABLE_AUTH_ERROR_CODES.has(error.code);
}

export function isSessionInvalidAuthError(error: unknown): boolean {
  return isApiError(error) && SESSION_INVALID_AUTH_ERROR_CODES.has(error.code);
}

export function isTransientAuthError(error: unknown): boolean {
  return isApiError(error) && TRANSIENT_AUTH_ERROR_CODES.has(error.code);
}
