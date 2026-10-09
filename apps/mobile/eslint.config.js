// Config ESLint flat para el proyecto Expo.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const PHOENIX_IMPORT_MESSAGE =
  'Use the socket module (@/api/socket) instead of importing the Phoenix client directly.';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.claude/**'],
  },
  {
    rules: {
      'react/display-name': 'off',
    },
  },
  {
    // src/api/socket owns the Phoenix client: connect, auth, join and reconnect.
    ignores: ['src/api/socket/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'phoenix', message: PHOENIX_IMPORT_MESSAGE }],
          patterns: [{ group: ['phoenix/*'], message: PHOENIX_IMPORT_MESSAGE }],
        },
      ],
    },
  },
]);
