// Tipos de NativeWind para habilitar className en TS.
// @ts-ignore
/// <reference types="nativewind/types" />

// Tipos basicos para variables de entorno en Expo.
declare const process: {
  env: {
    EXPO_PUBLIC_START_HOME?: string;
    [key: string]: string | undefined;
  };
};
