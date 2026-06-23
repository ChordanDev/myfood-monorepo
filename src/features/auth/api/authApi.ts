import { apiClient } from '@/api/client';
import { getDeviceId, persistSession } from '@/api/authTokenStore';
import type { AuthFlow, AuthSession, CodeRequestResponse, CurrentMe } from '../types/auth';
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

export async function verifyCode(
  email: string,
  code: string,
  flow: AuthFlow
): Promise<AuthSession> {
  const deviceId = await getDeviceId();
  const session = await apiClient.post<AuthSession>(endpointForVerify(flow), {
    email,
    code,
    deviceId,
  });
  await persistSession(session);
  return session;
}

export function verifyAndSignIn(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'login');
}

export function verifyAndSignUp(email: string, code: string): Promise<AuthSession> {
  return verifyCode(email, code, 'register');
}

export function getMe(accessToken?: string | null, options?: RequestOptions): Promise<CurrentMe> {
  return apiClient.get<CurrentMe>('/api/me', {
    ...options,
    auth: accessToken === undefined,
    accessToken,
    retry: options?.retry ?? true,
  });
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
