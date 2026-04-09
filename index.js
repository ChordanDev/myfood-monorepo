// Seed a safe Reanimated logger config before Expo Router evaluates routes.
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

require('expo-router/entry');
