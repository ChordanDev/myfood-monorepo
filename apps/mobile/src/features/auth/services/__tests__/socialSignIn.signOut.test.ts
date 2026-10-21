/* eslint-disable @typescript-eslint/no-require-imports */
import type { GoogleSignin as GoogleSigninType } from '@react-native-google-signin/google-signin';

// Issue #407 — signing out of the Google SDK on logout. Each test loads a fresh module, so the
// "already configured" flag of one test never leaks into the next.

type SignOutModule = typeof import('../socialSignIn');

function loadFresh(): {
  signOutOfGoogle: SignOutModule['signOutOfGoogle'];
  google: typeof GoogleSigninType;
} {
  let loaded!: ReturnType<typeof loadFresh>;
  jest.isolateModules(() => {
    loaded = {
      signOutOfGoogle: (require('../socialSignIn') as SignOutModule).signOutOfGoogle,
      google: require('@react-native-google-signin/google-signin').GoogleSignin,
    };
  });
  return loaded;
}

describe('signOutOfGoogle', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    jest.restoreAllMocks();
  });

  describe('in a build with the Google client IDs', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-id';
      process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
    });

    it('configures the SDK before signing out, as after an app restart', async () => {
      const { signOutOfGoogle, google } = loadFresh();

      await signOutOfGoogle();

      expect(google.configure).toHaveBeenCalledTimes(1);
      expect(google.signOut).toHaveBeenCalledTimes(1);
      expect(jest.mocked(google.configure).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(google.signOut).mock.invocationCallOrder[0]
      );
    });

    it('resolves when the SDK fails to sign out', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { signOutOfGoogle, google } = loadFresh();
      jest.mocked(google.signOut).mockRejectedValueOnce(new Error('SDK failure'));

      await expect(signOutOfGoogle()).resolves.toBeUndefined();
    });
  });

  it('leaves the SDK alone in a build without the Google client IDs', async () => {
    const { signOutOfGoogle, google } = loadFresh();

    await signOutOfGoogle();

    expect(google.configure).not.toHaveBeenCalled();
    expect(google.signOut).not.toHaveBeenCalled();
  });
});
