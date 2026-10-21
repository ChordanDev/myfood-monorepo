/* global jest */

// The native AsyncStorage module does not exist under Jest. Every suite gets the library's own
// in-memory mock, so a module that persists through it loads in any suite.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The native Google Sign-In module does not exist under Jest either, and the auth context loads
// it to sign out of Google. A suite that drives the Google sheet mocks the module itself.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(() => Promise.resolve(null)),
  },
  isCancelledResponse: (response) => response.type === 'cancelled',
}));
