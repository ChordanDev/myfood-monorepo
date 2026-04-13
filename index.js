// Config segura del logger de Reanimated antes de cargar Expo Router.
if (globalThis.__reanimatedLoggerConfig == null) {
  globalThis.__reanimatedLoggerConfig = {
    level: 1,
    strict: false,
    logFunction(data) {
      if (data?.level >= 2) {
        console.error(data?.message);
      } else {
        console.warn(data?.message);
      }
    },
  };
}

// Punto de entrada de Expo Router.
require('expo-router/entry');
