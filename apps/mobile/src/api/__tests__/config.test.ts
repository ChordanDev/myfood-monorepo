import { getSocketUrl } from '../config';

describe('getSocketUrl', () => {
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  it.each([
    ['https://api.example.test', 'wss://api.example.test/socket'],
    ['http://127.0.0.1:4000', 'ws://127.0.0.1:4000/socket'],
    ['https://api.example.test/', 'wss://api.example.test/socket'],
    ['https://example.test/backend', 'wss://example.test/backend/socket'],
    ['http://example.test/backend//', 'ws://example.test/backend/socket'],
  ])('derives the socket URL from %s', (apiUrl, socketUrl) => {
    process.env.EXPO_PUBLIC_API_URL = apiUrl;

    expect(getSocketUrl()).toBe(socketUrl);
  });

  it('fails with a configuration error when the API URL is missing', () => {
    process.env.EXPO_PUBLIC_API_URL = '';

    expect(() => getSocketUrl()).toThrow(expect.objectContaining({ code: 'configuration_error' }));
  });
});
