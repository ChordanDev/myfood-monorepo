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
  'validation_error',
  'invalid_cooking_skill',
  'slot_cooking_times_not_found',
  'invalid_hunger_level',
  'invalid_diet',
  'invalid_hard_restriction',
  'inventory_item_not_found',
  'shopping_item_not_manual',
  'shopping_item_not_found',
  'generation_in_progress',
  'no_active_generation',
  'missing_session_id',
  'account_expired',
  'invalid_proposal_id',
  'not_found',
  'subscription_required',
  'invalid_range',
  'overlapping_range',
  'forbidden_intent',
  'unknown_intent',
  'invalid_payload',
  'session_mismatch',
  'no_active_session',
  'forbidden',
  'already_confirmed',
  'foreign_lock',
  'not_a_member',
  'missing_lock',
  'lost_lock',
  'terminal_lock',
  'transaction_failed',
  'already_active',
  'invalid_identity',
  'invalid_date',
  'invalid_date_range',
  'optimization_failed',
  'optimizer_unavailable',
  'optimizer_timeout',
  'recipe_not_found',
  'scheduled_meal_not_found',
  'cooking_session_not_active',
  'cooking_already_finished',
  'cooking_chat_unavailable',
  'inventory_mutation_failed',
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
  validation_error: 'Los datos ingresados no son válidos.',
  invalid_cooking_skill: 'La experiencia cocinando seleccionada no es válida.',
  slot_cooking_times_not_found: 'Todavía no guardaste tus tiempos de cocina.',
  invalid_hunger_level: 'El nivel de hambre elegido no es válido.',
  invalid_diet: 'La dieta elegida no es válida.',
  invalid_hard_restriction: 'Una de las restricciones elegidas no es válida.',
  inventory_item_not_found: 'No encontramos ese producto en tu inventario.',
  shopping_item_not_manual: 'Solo podés borrar un producto que agregaste vos.',
  shopping_item_not_found: 'No encontramos ese producto en tu lista de compras.',
  generation_in_progress: 'Ya estamos generando un menú. Esperá a que termine.',
  no_active_generation: 'No hay un menú en generación. Generá uno nuevo para continuar.',
  missing_session_id: 'No encontramos tu sesión de planificación. Empezá una nueva para continuar.',
  account_expired: 'El acceso de tu cuenta venció.',
  invalid_proposal_id: 'La propuesta de menú no es válida.',
  not_found: 'No encontramos lo que buscabas.',
  subscription_required: 'Necesitás una suscripción activa para continuar.',
  invalid_range: 'El rango de fechas no es válido.',
  overlapping_range: 'Esas fechas se superponen con una planificación en curso.',
  forbidden_intent: 'Ese cambio no está permitido.',
  unknown_intent: 'No pudimos entender ese cambio. Probá de nuevo.',
  invalid_payload: 'Los datos enviados no son válidos.',
  session_mismatch:
    'La sesión de planificación no coincide con la que iniciaste. Empezá una nueva.',
  no_active_session: 'No tenés una planificación en curso. Empezá una nueva para continuar.',
  forbidden: 'No tenés permiso para hacer esto.',
  already_confirmed: 'Esta propuesta ya fue confirmada.',
  foreign_lock: 'Esa planificación pertenece a otra cuenta.',
  not_a_member: 'No sos miembro activo de esta cuenta.',
  missing_lock: 'No encontramos tu sesión de planificación. Empezá una nueva para continuar.',
  lost_lock: 'Tu sesión de planificación se interrumpió. Empezá una nueva para continuar.',
  terminal_lock: 'Tu sesión de planificación ya terminó. Empezá una nueva para continuar.',
  transaction_failed: 'No pudimos confirmar el menú y no se guardó ningún cambio. Probá de nuevo.',
  already_active: 'Ya tenés una planificación en curso.',
  invalid_identity: 'No pudimos identificar tu sesión. Iniciá sesión nuevamente.',
  invalid_date: 'La fecha ingresada no es válida.',
  invalid_date_range: 'La fecha de inicio no puede ser posterior a la de fin.',
  optimization_failed: 'No pudimos armar un menú con esas condiciones. Probá con otras.',
  optimizer_unavailable:
    'No pudimos generar el menú en este momento. Probá de nuevo en un momento.',
  optimizer_timeout: 'La generación del menú tardó demasiado. Probá de nuevo en un momento.',
  recipe_not_found: 'No encontramos esa receta.',
  scheduled_meal_not_found: 'No encontramos esa comida en tu plan.',
  cooking_session_not_active: 'Esta sesión de cocina ya no está activa. Volvé a empezar.',
  cooking_already_finished: 'Esta comida ya figura como cocinada.',
  cooking_chat_unavailable: 'Solo podés marcar como cocinada una comida de hoy.',
  inventory_mutation_failed:
    'No pudimos descontar los ingredientes y no se guardó ningún cambio. Probá de nuevo.',
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
