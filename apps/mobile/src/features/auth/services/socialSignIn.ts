import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isCancelledResponse } from '@react-native-google-signin/google-signin';
import { ApiError } from '@/api/errors';
import type { SocialProvider } from '../types/auth';

const APPLE_CANCELLED_CODE = 'ERR_REQUEST_CANCELED';

let googleConfigured = false;

function configureGoogle(): void {
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  googleConfigured = true;
}

// A provider that answers without an identity token cannot sign in: the API would refuse it the
// same way it refuses a forged one.
function missingIdToken(): ApiError {
  return new ApiError('social_token_invalid', 'The provider returned no identity token.');
}

async function requestAppleIdToken(): Promise<string | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      ],
    });
    if (!credential.identityToken) throw missingIdToken();
    return credential.identityToken;
  } catch (error) {
    if ((error as { code?: string } | null)?.code === APPLE_CANCELLED_CODE) return null;
    throw error;
  }
}

async function requestGoogleIdToken(): Promise<string | null> {
  configureGoogle();
  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response)) return null;
  if (!response.data.idToken) throw missingIdToken();
  return response.data.idToken;
}

// The SDK cannot ask Google for an ID token without the web client ID, nor open its sheet on iOS
// without the iOS one; a build without them shows no Google button.
function isGoogleConfigured(): boolean {
  if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) return false;
  if (Platform.OS === 'ios') return Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  return Platform.OS === 'android';
}

/**
 * Google signs in on iOS and Android when the build has its client IDs; Apple only on iOS, and
 * not on every iOS device.
 */
export async function isSocialProviderAvailable(provider: SocialProvider): Promise<boolean> {
  if (provider === 'google') return isGoogleConfigured();
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Runs the provider's sign-in sheet and answers its identity token, or `null` when the User
 * dismissed the sheet (not an error: nothing to show).
 */
export function requestSocialIdToken(provider: SocialProvider): Promise<string | null> {
  return provider === 'apple' ? requestAppleIdToken() : requestGoogleIdToken();
}
