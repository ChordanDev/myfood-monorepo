// Passthrough mock for `react-native-css-interop` used by AuthContext unit tests.
//
// The NativeWind babel plugin auto-injects an import of
// `react-native-css-interop` on any file that contains JSX or that
// the plugin detects a `React.createElement` call. The real module
// reads `Appearance.getColorScheme()`, `AccessibilityInfo.isReduceMotionEnabled`,
// and `Dimensions.get('window')` at import time, which breaks unit
// tests that do not provide a full react-native runtime.
//
// This file lives in its own module so the test file can
// `jest.mock('react-native-css-interop', () => require('./cssInteropMock'))`
// — the factory references an out-of-scope `require` (which IS in
// jest's allowed-vars list), so the hoisted factory does not
// collide with the babel-auto-injected `_ReactNativeCSSInterop`
// import that babel puts at the top of the test file.

const passthrough = (type, props, ...children) => {
  const react = require('react');
  return react.createElement(type, props, ...children);
};

module.exports = {
  createInteropElement: passthrough,
  default: {
    createInteropElement: passthrough,
  },
};
