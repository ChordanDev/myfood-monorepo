const { expo } = require('./app.json');

module.exports = {
  ...expo,
  ios: {
    ...expo.ios,
    ...(process.env.APP_VARIANT === 'e2e' ? { bundleIdentifier: 'com.myfood.e2e' } : {}),
  },
};
