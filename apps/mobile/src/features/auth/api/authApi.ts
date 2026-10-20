import { apiClient } from '@/api/client';
import { getDeviceId, persistSession } from '@/api/authTokenStore';
import type {
  AuthFlow,
  AuthSession,
  CodeRequestResponse,
  CurrentMe,
  SocialProvider,
} from '../types/auth';
import { normalizeCurrentMe } from '../utils/currentMe';
import type { RequestOptions } from '@/api/transport';

function endpointForRequest(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/request-code' : '/api/auth/login/request-code';
}

function endpointForVerify(flow: AuthFlow): string {
  return flow === 'register' ? '/api/auth/signup/verify-code' : '/api/auth/login/verify-code';
}

export async function requestVerificationCode(
  email: string,
  flow: AuthFlow
): Promise<CodeRequestResponse> {
  return apiClient.post<CodeRequestResponse>(endpointForRequest(flow), { email });
}

export function sendVerificationCode(
  email: string,
  flow: AuthFlow = 'login'
): Promise<CodeRequestResponse> {
  return requestVerificationCode(email, flow);
}

// Both proofs (email code, provider token) answer the same session body, so they share how the
// session is read and stored.
async function postForSession(
  endpoint: string,
  body: Record<string, string>
): Promise<AuthSession> {
  const deviceId = await getDeviceId();
  const response = await apiClient.post<AuthSession>(endpoint, { ...body, deviceId });
  const session: AuthSession = { ...response, me: normalizeCurrentMe(response.me) };
  await persistSession(session);
  return session;
}

export function verifyCode(email: string, code: string, flow: AuthFlow): Promise<AuthSession> {
  return postForSession(endpointForVerify(flow), { email, code });
}

export function signInWithSocial(provider: SocialProvider, idToken: string): Promise<AuthSession> {
  return postForSession('/api/auth/social', { provider, idToken });
}

export function verifyAndSignIn(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'login');
}

export function verifyAndSignUp(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'register');
}

export async function getMe(
  accessToken?: string | null,
  options?: RequestOptions
): Promise<CurrentMe> {
  const me = await apiClient.get<CurrentMe>('/api/me', {
    ...options,
    auth: accessToken === undefined,
    accessToken,
    retry: options?.retry ?? true,
  });
  return normalizeCurrentMe(me);
}

export async function logout(
  accessToken: string | null,
  refreshToken?: string | null
): Promise<void> {
  if (!accessToken) return;

  await apiClient.post<null>('/api/auth/logout', refreshToken ? { refreshToken } : undefined, {
    accessToken,
  });
}
