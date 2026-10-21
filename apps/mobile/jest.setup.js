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

// RevenueCat's native SDK does not exist under Jest. The app configures it at startup and logs
// it in and out with the Account, so every suite gets an inert SDK: an anonymous user with no
// active entitlement, and a Paywall the User cancels. A suite that drives billing overrides
// these per test.
jest.mock('react-native-purchases', () => {
  const emptyCustomerInfo = { entitlements: { active: {}, all: {} }, activeSubscriptions: [] };
  return {
    __esModule: true,
    default: {
      configure: jest.fn(),
      setLogLevel: jest.fn(() => Promise.resolve()),
      logIn: jest.fn(() => Promise.resolve({ customerInfo: emptyCustomerInfo, created: false })),
      logOut: jest.fn(() => Promise.resolve(emptyCustomerInfo)),
      isAnonymous: jest.fn(() => Promise.resolve(true)),
      getCustomerInfo: jest.fn(() => Promise.resolve(emptyCustomerInfo)),
      addCustomerInfoUpdateListener: jest.fn(),
      removeCustomerInfoUpdateListener: jest.fn(() => true),
    },
    LOG_LEVEL: { VERBOSE: 'VERBOSE', DEBUG: 'DEBUG', INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' },
  };
});

jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    presentPaywall: jest.fn(() => Promise.resolve('CANCELLED')),
    presentCustomerCenter: jest.fn(() => Promise.resolve()),
  },
  PAYWALL_RESULT: {
    NOT_PRESENTED: 'NOT_PRESENTED',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED',
    PURCHASED: 'PURCHASED',
    RESTORED: 'RESTORED',
  },
}));
