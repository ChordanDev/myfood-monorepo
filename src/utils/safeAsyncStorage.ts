import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Custom storage wrapper to prevent crashes in mixed environments
 * (e.g. Expo Go, Jest, web fallbacks) when AsyncStorage native module is absent.
 */
export const safeAsyncStorage = {
  getItem: async (name: string) => {
    try {
      return await AsyncStorage.getItem(name);
    } catch (e) {
      console.warn('AsyncStorage get failed:', e);
      return null;
    }
  },
  setItem: async (name: string, value: string) => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch (e) {
      console.warn('AsyncStorage set failed:', e);
    }
  },
  removeItem: async (name: string) => {
    try {
      await AsyncStorage.removeItem(name);
    } catch (e) {
      console.warn('AsyncStorage remove failed:', e);
    }
  },
};
