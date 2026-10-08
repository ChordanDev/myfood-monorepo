import { Socket } from 'phoenix';

import { refreshTokens } from '../authRefresh';
import { getAccessToken, subscribeToAccessToken } from '../authTokenStore';
import { getSocketUrl } from '../config';
import { createSocketClient, type SocketClient } from './socketClient';

let appSocketClient: SocketClient | null = null;

/**
 * The app's single socket client, wired to the stored session and to the
 * refresh shared with the HTTP client. It is created on first use: importing
 * this module neither reads the stored session nor opens a connection.
 */
export function getSocketClient(): SocketClient {
  appSocketClient ??= createSocketClient({
    url: getSocketUrl(),
    createSocket: (url, options) => new Socket(url, options),
    getAccessToken,
    refreshTokens: () => refreshTokens(),
    subscribeToAccessToken,
  });
  return appSocketClient;
}

export function __resetSocketClientForTests(): void {
  appSocketClient?.disconnect();
  appSocketClient = null;
}
