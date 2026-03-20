module.exports = function (api) {
  api.cache(true);
  const plugins = ['expo-router/babel', 'react-native-worklets/plugin'];

  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],

    plugins,
  };
};
