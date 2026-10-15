/* global jest */

// The native AsyncStorage module does not exist under Jest. Every suite gets the library's own
// in-memory mock, so a module that persists through it loads in any suite.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
