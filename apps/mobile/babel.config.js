// Babel configuration for Expo and Reanimated.
module.exports = function (api) {
  api.cache(true);
  const plugins = ['react-native-reanimated/plugin'];

  return {
    presets: ['babel-preset-expo'],

    plugins,
  };
};
