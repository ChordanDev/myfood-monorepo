/* eslint-disable @typescript-eslint/no-require-imports */
/// <reference types="node" />
import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  MANUAL_DISH_SOAP,
  RICE_NEEDED_ITEM_IDS,
  SHOPPING_LIST_AFTER_PURCHASE,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_WITH_CART_OUT_OF_RANGE,
  SHOPPING_LIST_WITH_MANUAL_AND_REMOVED,
  TOMATO_ITEM_IDS,
  toDeleteItemResponse,
  toSetStatusResponse,
  toShoppingErrorResponse,
  toShoppingListResponse,
} from '../fixtures';
import { useShoppingListStore } from '../store';
import type { ShoppingListRead } from '../types';
import { useShoppingList } from './useShoppingList';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@/features/auth', () => ({
  useAuth: () => ({ user: { id: 'user-a' } }),
}));

jest.mock('expo-router', () => {
  const { useEffect } = require('react');

  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 422) {
  return { ok, status, text: () => Promise.resolve(JSON.stringify(payload)) } as Response;
}

function answerWithList(read: ShoppingListRead) {
  fetchMock.mockResolvedValueOnce(jsonResponse(toShoppingListResponse(read)));
}

const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: init.method as string,
    path: (url as string).replace('https://api.example.test', '').split('?')[0],
    body: init.body ? JSON.parse(init.body) : undefined,
  }));

type ShoppingListHook = ReturnType<typeof useShoppingList>;

// The hook on a component, read through `current` after the first read has landed.
async function renderHook(read: ShoppingListRead) {
  const result = { current: undefined as unknown as ShoppingListHook };

  function Probe() {
    result.current = useShoppingList();
    return null;
  }

  answerWithList(read);
  await act(async () => {
    create(<Probe />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fetchMock.mockClear();

  return result;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockSecureStore.clear();
  mockSecureStore.set('auth_access_token', 'access-1');
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  useShoppingListStore.setState(useShoppingListStore.getInitialState(), true);
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

describe('useShoppingList: items added by hand and removed ones', () => {
  it('serves the manual items apart, and counts the removed lines', async () => {
    const hook = await renderHook(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);

    expect(hook.current.manualItems).toEqual([MANUAL_DISH_SOAP]);
    expect(hook.current.removedCount).toBe(1);
    // A removed line is in no group, and a manual one is in none either.
    const names = hook.current.groups.flatMap((group) => group.items.map((item) => item.name));
    expect(names).not.toContain('Tomate');
    expect(names).not.toContain('Detergente');
  });

  it('has no manual item and nothing removed in the plain plan', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);

    expect(hook.current.manualItems).toEqual([]);
    expect(hook.current.removedCount).toBe(0);
  });

  it('deletes a manual item by its id', async () => {
    const hook = await renderHook(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
    fetchMock.mockResolvedValueOnce(jsonResponse(toDeleteItemResponse(MANUAL_DISH_SOAP.id)));
    answerWithList(SHOPPING_LIST_BY_INGREDIENT);

    await act(async () => {
      await hook.current.removeItem(MANUAL_DISH_SOAP.id);
    });

    expect(requests().map(({ method, path }) => `${method} ${path}`)).toEqual([
      `DELETE /api/shopping-items/${MANUAL_DISH_SOAP.id}`,
      'GET /api/shopping-list',
    ]);
    expect(hook.current.manualItems).toEqual([]);
  });

  it('removes a planned line through every share of it', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);
    const tomato = SHOPPING_LIST_BY_INGREDIENT.planned.find((line) => line.name === 'Tomate')!;
    fetchMock.mockResolvedValueOnce(jsonResponse(toSetStatusResponse('removed', TOMATO_ITEM_IDS)));
    answerWithList(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);

    await act(async () => {
      await hook.current.removeItem(tomato.id);
    });

    expect(requests()[0]).toMatchObject({
      method: 'POST',
      path: '/api/shopping-items/set-status',
      body: { itemIds: TOMATO_ITEM_IDS, status: 'removed' },
    });
    expect(hook.current.removedCount).toBe(1);
  });

  it('removes a line bought in part through the shares that are not bought', async () => {
    const hook = await renderHook(SHOPPING_LIST_AFTER_PURCHASE);
    const rice = SHOPPING_LIST_AFTER_PURCHASE.planned.find((line) => line.name === 'Arroz')!;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(toSetStatusResponse('removed', RICE_NEEDED_ITEM_IDS))
    );
    answerWithList(SHOPPING_LIST_AFTER_PURCHASE);

    await act(async () => {
      await hook.current.removeItem(rice.id);
    });

    expect(requests()[0].body).toEqual({ itemIds: RICE_NEEDED_ITEM_IDS, status: 'removed' });
  });

  it('keeps a purchased line listed, counts its lines for the Cart apart, and never removes it', async () => {
    const hook = await renderHook(SHOPPING_LIST_AFTER_PURCHASE);
    const oil = SHOPPING_LIST_AFTER_PURCHASE.planned.find(
      (line) => line.name === 'Aceite de oliva'
    )!;

    const names = hook.current.groups.flatMap((group) => group.items.map((item) => item.name));
    expect(names).toContain('Aceite de oliva');
    expect(hook.current.cartLines).toEqual([]);

    await act(async () => {
      await hook.current.removeItem(oil.id);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves the lines of the Cart of the read', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);

    expect(hook.current.cartLines.map(({ name, quantityMilli }) => [name, quantityMilli])).toEqual([
      ['Arroz', 400_000],
      ['Aceite de oliva', 30_000],
    ]);
  });

  it('counts no hidden item while the read lists every item of the Cart', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);

    expect(hook.current.hiddenCartItemsCount).toBe(0);
  });

  it('counts the items of the Cart that the read does not list', async () => {
    const hook = await renderHook(SHOPPING_LIST_WITH_CART_OUT_OF_RANGE);

    expect(hook.current.hiddenCartItemsCount).toBe(2);
  });

  it('restores every removed line', async () => {
    const hook = await renderHook(SHOPPING_LIST_WITH_MANUAL_AND_REMOVED);
    fetchMock.mockResolvedValueOnce(jsonResponse(toSetStatusResponse('needed', TOMATO_ITEM_IDS)));
    answerWithList(SHOPPING_LIST_BY_INGREDIENT);

    await act(async () => {
      await hook.current.restoreItems();
    });

    expect(requests()[0].body).toEqual({ itemIds: TOMATO_ITEM_IDS, status: 'needed' });
    expect(hook.current.removedCount).toBe(0);
  });

  it('asks for nothing when there is no such line, or nothing removed', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);

    await act(async () => {
      await hook.current.removeItem('unknown');
      await hook.current.restoreItems();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says in words why a change was refused, until it is dismissed', async () => {
    const hook = await renderHook(SHOPPING_LIST_BY_INGREDIENT);
    const rice = SHOPPING_LIST_BY_INGREDIENT.planned[0];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(toShoppingErrorResponse('shopping_item_in_cart', 'In a Cart.'), false, 409)
    );

    await act(async () => {
      await hook.current.removeItem(rice.id);
    });

    expect(hook.current.changeErrorMessage).toBe(
      'Sacá el producto del carrito antes de quitarlo de la lista.'
    );
    expect(hook.current.manualItems).toEqual([]);

    await act(async () => {
      hook.current.dismissChangeError();
    });
    await settle();
    expect(hook.current.changeErrorMessage).toBeUndefined();
  });
});
