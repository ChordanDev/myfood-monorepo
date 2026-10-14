import * as ReactNative from 'react-native';

// The React Native exports the app draws with. Add one here when a screen starts using another.
const USED_BY_THE_APP = [
  'ActivityIndicator',
  'Alert',
  'AppState',
  'BackHandler',
  'Image',
  'ImageBackground',
  'Keyboard',
  'KeyboardAvoidingView',
  'Modal',
  'Platform',
  'Pressable',
  'ScrollView',
  'StyleSheet',
  'Text',
  'TextInput',
  'View',
  'useWindowDimensions',
] as const;

/**
 * `react-native` hands out each export through a getter that requires it on first use, so the
 * first test to draw a screen also loads, and on a cold Jest cache Babel-transforms, every React
 * Native component that screen shows. Under CPU contention that passed the 5 s budget of the
 * first test. Call it from `beforeAll` with a budget of its own, so each test only times what it
 * tests:
 *
 *     beforeAll(loadReactNative, 30_000);
 *
 * It runs per suite, not from a Jest setup file: a setup file runs before the suite's
 * `jest.mock('react-native/...')` calls are registered, so it would load the real modules
 * those suites replace.
 */
export function loadReactNative() {
  for (const name of USED_BY_THE_APP) {
    void ReactNative[name];
  }
}
