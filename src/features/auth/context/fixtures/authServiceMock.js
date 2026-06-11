// Jest manual mock for @/services/authService used by the
// AuthContext optimistic-latch tests. Lives in its own CommonJS file
// so the test file's hoisted `jest.mock` factory only references
// `require(...)` (which jest's static analyzer allows) and not
// module-scope `const`s that might collide with the babel-auto-injected
// `_ReactNativeCSSInterop` import at the top of the test file.

/* global jest */

class MockAuthApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    if (typeof status === 'number') {
      this.status = status;
    }
    this.name = 'AuthApiError';
  }
}

const mockService = {
  __esModule: true,
  restoreSessionWithFreshMe: jest.fn(),
  refreshCurrentSession: jest.fn(),
  completeOnboarding: jest.fn(),
  getStoredSession: jest.fn(),
  clearSession: jest.fn(),
  logout: jest.fn(),
  getAuthErrorMessage: (e) => (e instanceof Error ? e.message : 'unknown error'),
  AuthApiError: MockAuthApiError,
  isTransientAuthError: jest.fn(() => false),
  isAuthApiError: (e) => e instanceof MockAuthApiError,
  isSessionInvalidAuthError: jest.fn(() => false),
  isRefreshableAuthError: jest.fn(() => false),
  requestVerificationCode: jest.fn(),
  sendVerificationCode: jest.fn(),
  verifyCode: jest.fn(),
  verifyAndSignIn: jest.fn(),
  verifyAndSignUp: jest.fn(),
  getMe: jest.fn(),
  getUserPreferences: jest.fn(),
  updateUserPreferences: jest.fn(),
  getSlotCookingTimes: jest.fn(),
  updateSlotCookingTimes: jest.fn(),
  refreshTokens: jest.fn(),
  persistSession: jest.fn(),
  default: {},
};

module.exports = mockService;
