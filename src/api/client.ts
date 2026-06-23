import { getAccessToken } from './authTokenStore';
import { refreshTokens } from './authRefresh';
import { isRefreshableAuthError } from './errors';
import { rawApiRequest, type RequestOptions } from './transport';

interface ApiClientRequestOptions extends RequestOptions {
  auth?: boolean;
  accessToken?: string | null;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { auth = false, accessToken, ...options }: ApiClientRequestOptions = {}
): Promise<T> {
  const token = accessToken ?? (auth ? await getAccessToken() : null);

  try {
    return await rawApiRequest<T>(path, { ...options, init, accessToken: token });
  } catch (error) {
    if (!auth || !isRefreshableAuthError(error)) {
      throw error;
    }

    const refreshed = await refreshTokens();
    return rawApiRequest<T>(path, {
      ...options,
      init,
      accessToken: refreshed.accessToken,
      retry: false,
    });
  }
}

export const apiClient = {
  request,

  get<T>(path: string, options?: ApiClientRequestOptions): Promise<T> {
    return request<T>(path, { method: 'GET', headers: options?.headers }, options);
  },

  post<T>(path: string, body?: unknown, options?: ApiClientRequestOptions): Promise<T> {
    return request<T>(
      path,
      {
        method: 'POST',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      options
    );
  },

  put<T>(path: string, body: unknown, options?: ApiClientRequestOptions): Promise<T> {
    return request<T>(
      path,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
      options
    );
  },
};

export type { ApiClientRequestOptions, RequestOptions };
