import { Platform } from 'react-native';
import { secureStorage } from '../secureStorage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

type LocalStorageMock = {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

const getItemAsync = SecureStore.getItemAsync as jest.Mock;
const setItemAsync = SecureStore.setItemAsync as jest.Mock;
const deleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const ls: LocalStorageMock = {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
    }),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: ls,
    configurable: true,
    writable: true,
  });
  return { ls, store };
}

describe('secureStorage', () => {
  beforeEach(() => {
    getItemAsync.mockReset();
    setItemAsync.mockReset();
    deleteItemAsync.mockReset();
    installLocalStorageMock();
  });

  describe('on web (Platform.OS === "web")', () => {
    let ls: LocalStorageMock;
    let store: Map<string, string>;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', {
        value: 'web',
        configurable: true,
        writable: true,
      });
      ({ ls, store } = installLocalStorageMock());
    });

    it('getItem reads from localStorage, never from SecureStore', async () => {
      store.set('k', 'v');

      const result = await secureStorage.getItem('k');

      expect(result).toBe('v');
      expect(ls.getItem).toHaveBeenCalledWith('k');
      expect(getItemAsync).not.toHaveBeenCalled();
    });

    it('setItem writes to localStorage, never to SecureStore', async () => {
      await secureStorage.setItem('k', 'v');

      expect(ls.setItem).toHaveBeenCalledWith('k', 'v');
      expect(store.get('k')).toBe('v');
      expect(setItemAsync).not.toHaveBeenCalled();
    });

    it('deleteItem removes from localStorage, never from SecureStore', async () => {
      store.set('k', 'v');

      await secureStorage.deleteItem('k');

      expect(ls.removeItem).toHaveBeenCalledWith('k');
      expect(store.has('k')).toBe(false);
      expect(deleteItemAsync).not.toHaveBeenCalled();
    });

    it('returns null instead of throwing when localStorage access throws', async () => {
      ls.getItem.mockImplementationOnce(() => {
        throw new Error('SecurityError');
      });

      await expect(secureStorage.getItem('k')).resolves.toBeNull();
    });
  });

  describe('on ios (Platform.OS === "ios")', () => {
    let ls: LocalStorageMock;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', {
        value: 'ios',
        configurable: true,
        writable: true,
      });
      ({ ls } = installLocalStorageMock());
    });

    it('getItem delegates to SecureStore.getItemAsync and never reads localStorage', async () => {
      getItemAsync.mockResolvedValueOnce('secure-v');

      const result = await secureStorage.getItem('k');

      expect(result).toBe('secure-v');
      expect(getItemAsync).toHaveBeenCalledWith('k');
      expect(ls.getItem).not.toHaveBeenCalled();
    });

    it('setItem delegates to SecureStore.setItemAsync and never writes localStorage', async () => {
      setItemAsync.mockResolvedValueOnce(undefined);

      await secureStorage.setItem('k', 'v');

      expect(setItemAsync).toHaveBeenCalledWith('k', 'v');
      expect(ls.setItem).not.toHaveBeenCalled();
    });

    it('deleteItem delegates to SecureStore.deleteItemAsync and never touches localStorage', async () => {
      deleteItemAsync.mockResolvedValueOnce(undefined);

      await secureStorage.deleteItem('k');

      expect(deleteItemAsync).toHaveBeenCalledWith('k');
      expect(ls.removeItem).not.toHaveBeenCalled();
    });
  });
});
