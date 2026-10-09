/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { AppState } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import * as shoppingApi from '../api/shoppingApi';
import { useCartLease } from './useCartLease';

jest.mock('../api/shoppingApi');

// The screen is in focus until a test says otherwise; the cleanup is what leaving it runs.
let mockSetFocused: ((focused: boolean) => void) | undefined;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');

  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        let cleanup = effect();
        mockSetFocused = (focused) => {
          if (focused && !cleanup) cleanup = effect();
          if (!focused && cleanup) {
            cleanup();
            cleanup = undefined;
          }
        };
        return () => cleanup?.();
      }, [effect]);
    },
  };
});

const api = shoppingApi as jest.Mocked<typeof shoppingApi>;

const LEASE = { sessionId: 'session-1', leaseExpiresAt: '2026-10-09T12:15:00Z' };

type Lease = ReturnType<typeof useCartLease>;

function setup(listCart: { sessionId: string; leaseExpiresAt: string } | null = null) {
  const refreshList = jest.fn();
  const result: { current: Lease } = { current: undefined as unknown as Lease };
  let appStateListener: ((state: string) => void) | undefined;

  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: string) => void;
    return { remove: () => (appStateListener = undefined) } as ReturnType<
      typeof AppState.addEventListener
    >;
  });

  function Harness() {
    result.current = useCartLease({ listCart, refreshList });
    return null;
  }

  act(() => {
    create(<Harness />);
  });

  return {
    result,
    refreshList,
    setAppState: (state: string) => act(() => appStateListener?.(state)),
    setFocused: (focused: boolean) => act(() => mockSetFocused?.(focused)),
  };
}

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function tickItems(result: { current: Lease }, ids = ['item-1']) {
  await act(async () => {
    await result.current.markItems(ids);
  });
}

describe('useCartLease', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    jest.resetAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
    api.markInCart.mockResolvedValue({ ...LEASE, items: [] });
    api.renewCart.mockResolvedValue(LEASE);
    api.cancelCart.mockResolvedValue({
      sessionId: 'session-1',
      updatedRows: 1,
      status: 'abandoned',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('ticking items', () => {
    it('marks the items, keeps the lease and reads the list again', async () => {
      const { result, refreshList } = setup();

      await tickItems(result, ['item-1', 'item-2']);

      expect(api.markInCart).toHaveBeenCalledWith(['item-1', 'item-2']);
      expect(result.current.cart).toEqual(LEASE);
      expect(refreshList).toHaveBeenCalledTimes(1);
    });

    it('tells that another member holds the items on `cart_locked`', async () => {
      api.markInCart.mockRejectedValue(new ApiError('cart_locked', 'held', 409));
      const { result } = setup();

      await tickItems(result);

      expect(result.current.isHeldByAnother).toBe(true);
      expect(result.current.cart).toBeNull();
    });

    it('forgets that state on the next successful tick', async () => {
      api.markInCart.mockRejectedValueOnce(new ApiError('cart_locked', 'held', 409));
      const { result } = setup();

      await tickItems(result);
      await tickItems(result);

      expect(result.current.isHeldByAnother).toBe(false);
    });
  });

  describe('renewing', () => {
    it('does not renew before a minute has passed', async () => {
      const { result } = setup();
      await tickItems(result);

      await tick(59_000);

      expect(api.renewCart).not.toHaveBeenCalled();
    });

    it('renews once a minute, not more often', async () => {
      const { result } = setup();
      await tickItems(result);

      await tick(60_000);
      expect(api.renewCart).toHaveBeenCalledTimes(1);
      expect(api.renewCart).toHaveBeenCalledWith('session-1');

      await tick(30_000);
      expect(api.renewCart).toHaveBeenCalledTimes(1);

      await tick(30_000);
      expect(api.renewCart).toHaveBeenCalledTimes(2);
    });

    it('renews the Cart the list reports for a screen opened on a held Cart', async () => {
      setup(LEASE);

      await tick(60_000);

      expect(api.renewCart).toHaveBeenCalledWith('session-1');
    });

    it('does not renew while the app is in the background', async () => {
      const { result, setAppState } = setup();
      await tickItems(result);
      setAppState('background');

      await tick(180_000);

      expect(api.renewCart).not.toHaveBeenCalled();
    });

    it('does not renew while the screen is not in focus', async () => {
      const { result, setFocused } = setup();
      await tickItems(result);
      setFocused(false);

      await tick(180_000);

      expect(api.renewCart).not.toHaveBeenCalled();
    });

    it('renews on coming back after a minute away, and not before', async () => {
      const { result, setAppState } = setup();
      await tickItems(result);
      setAppState('background');
      await tick(30_000);
      setAppState('active');
      expect(api.renewCart).not.toHaveBeenCalled();

      setAppState('background');
      await tick(60_000);
      setAppState('active');
      await tick(0);

      expect(api.renewCart).toHaveBeenCalledTimes(1);
    });

    it('does not renew without a Cart', async () => {
      setup();

      await tick(180_000);

      expect(api.renewCart).not.toHaveBeenCalled();
    });

    it('drops the Cart and reads the list again when the lease is stale', async () => {
      api.renewCart.mockRejectedValue(new ApiError('stale_cart', 'expired', 409));
      const { result, refreshList } = setup();
      await tickItems(result);
      refreshList.mockClear();

      await tick(60_000);

      expect(result.current.cart).toBeNull();
      expect(refreshList).toHaveBeenCalledTimes(1);
    });
  });

  describe('abandoning', () => {
    it('cancels the Cart, drops it and reads the list again', async () => {
      const { result, refreshList } = setup();
      await tickItems(result);
      refreshList.mockClear();

      await act(async () => {
        await result.current.cancel();
      });

      expect(api.cancelCart).toHaveBeenCalledWith('session-1');
      expect(result.current.cart).toBeNull();
      expect(refreshList).toHaveBeenCalledTimes(1);

      await tick(180_000);
      expect(api.renewCart).not.toHaveBeenCalled();
    });

    it('asks nothing when there is no Cart', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.cancel();
      });

      expect(api.cancelCart).not.toHaveBeenCalled();
    });
  });
});
