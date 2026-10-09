import { ACCESS_TOKEN_KEY } from '../authTokenStore';
import { apiClient } from '../client';

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

describe('apiClient.delete', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    mockSecureStore.clear();
    mockSecureStore.set(ACCESS_TOKEN_KEY, 'access-1');
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it('sends DELETE with the bearer token and resolves null on a 204 with no body', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve('') });

    const result = await apiClient.delete<unknown>('/api/things/1', { auth: true });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/things/1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});
