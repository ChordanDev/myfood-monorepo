const { expo } = require('./app.json');

module.exports = {
  ...expo,
  plugins: [
    ...expo.plugins,
    // Prebuild without Google client IDs still works: the plugin needs the reversed iOS client ID.
    ...(process.env.GOOGLE_IOS_URL_SCHEME
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME },
          ],
        ]
      : []),
  ],
  ios: {
    ...expo.ios,
    ...(process.env.APP_VARIANT === 'e2e' ? { bundleIdentifier: 'com.myfood.e2e' } : {}),
  },
};
