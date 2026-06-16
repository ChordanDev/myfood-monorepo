import { getItemAsync, setItemAsync, deleteItemAsync } from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Platform-aware wrapper around `expo-secure-store`.
 *
 * `expo-secure-store` does NOT support `web` and throws at runtime when
 * called there. Before this wrapper existed, every SecureStore call in
 * `authService.ts` ran unconditionally, so the moment the app loaded in
 * a browser, the session bootstrap would blow up before the user could
 * sign in.
 *
 * On `web` we fall back to `localStorage`. That is good enough for a
 * browser-based dev/demo run of the same code path and it is strictly
 * safer than letting SecureStore throw. All operations are wrapped in
 * `try`/`catch` because some browsers (Safari private mode, embedded
 * webviews) can deny localStorage access.
 *
 * On `ios` and `android` (and any other native platform that ships
 * `expo-secure-store`), we delegate to SecureStore. Tokens are
 * Keychain-backed on iOS and EncryptedSharedPreferences-backed on
 * Android, so the security properties of the original code are
 * preserved on native.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return getItemAsync(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Swallow: storage may be unavailable (Safari private mode).
      }
      return;
    }
    await setItemAsync(key, value);
  },

  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // Swallow.
      }
      return;
    }
    await deleteItemAsync(key);
  },
};
