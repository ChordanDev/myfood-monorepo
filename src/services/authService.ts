// Servicio de autenticacion MOCK.
// ------------------------------------------------------------------
// Este es el UNICO archivo que se reemplaza cuando el backend de
// Elixir este listo. Las funciones mantienen la misma firma; solo
// cambia la implementacion interna (fetch en vez de setTimeout).
// ------------------------------------------------------------------

import * as SecureStore from 'expo-secure-store';
import type { AuthSession, AuthUser } from '@/features/auth/types/auth';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

/** Delay artificial para simular latencia de red. */
const MOCK_DELAY_MS = 800;

function mockDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

/** Genera un usuario falso a partir del email. */
function buildMockUser(email: string): AuthUser {
  const localPart = email.split('@')[0] ?? 'usuario';
  return {
    id: `mock-${Date.now()}`,
    email,
    displayName: localPart.charAt(0).toUpperCase() + localPart.slice(1),
  };
}

/** Genera un token JWT falso. */
function buildMockToken(): string {
  return `mock-jwt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ------------------------------------------------------------------
// API publica — misma firma que el servicio real futuro.
// ------------------------------------------------------------------

/**
 * Simula el envio de un codigo de verificacion al email.
 * Produccion: POST /api/auth/send-code
 */
export async function sendVerificationCode(email: string): Promise<void> {
  await mockDelay();
  console.log(`[authService MOCK] Codigo de verificacion enviado a ${email}`);
}

/**
 * Verifica el codigo y crea una sesion (login).
 * Produccion: POST /api/auth/verify
 */
export async function verifyAndSignIn(email: string, _code: string): Promise<AuthSession> {
  await mockDelay();
  const user = buildMockUser(email);
  const token = buildMockToken();

  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));

  return { user, token };
}

/**
 * Verifica el codigo y registra al usuario (sign-up).
 * Produccion: POST /api/auth/register
 */
export async function verifyAndSignUp(email: string, _code: string): Promise<AuthSession> {
  // En el mock, signUp y signIn hacen lo mismo.
  return verifyAndSignIn(email, _code);
}

/**
 * Lee la sesion guardada en SecureStore (si existe).
 * Se llama al abrir la app para restaurar la sesion.
 */
export async function getStoredSession(): Promise<AuthSession | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const userJson = await SecureStore.getItemAsync(USER_KEY);

  if (!token || !userJson) {
    return null;
  }

  try {
    const user = JSON.parse(userJson) as AuthUser;
    return { user, token };
  } catch {
    // JSON corrupto — limpiar y tratar como sin sesion.
    await clearSession();
    return null;
  }
}

/**
 * Limpia la sesion guardada (logout).
 */
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}
