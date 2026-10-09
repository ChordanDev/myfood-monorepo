import { MOCK_INGREDIENTS } from '@/mocks/domainMocks';
import type { Ingredient } from '@/types/domain';
import {
  CHICKEN,
  INVENTORY_VIEW,
  MILK,
  ONION,
  RICE,
  STEW,
  VOICE_APPLY_RESULT,
  VOICE_PREVIEW_HIGH_CONFIDENCE,
  VOICE_TRANSCRIPT_HIGH,
  dataResponse,
  errorResponse,
  mutationEvent,
} from '../mocks';
import type { InventoryItem } from '../types';
import { migrateInventoryState, useInventoryStore } from './useInventoryStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('access-1')),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const API_URL = 'https://api.example.test';

const INGREDIENTS: Ingredient[] = [
  { id: 'rice', name: 'Rice', category: 'almacen', basePrice: 2, unit: 'g' },
  { id: 'milk', name: 'Milk', category: 'lacteos', basePrice: 3, unit: 'ml' },
];

// A lot of the catalog ingredient `rice`, as the cooking shim finds it.
const RICE_LOT: InventoryItem = { ...RICE, ingredientId: 'rice', quantityMilli: 500_000 };

const fetchMock = jest.fn();
const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

function getItems() {
  return useInventoryStore.getState().items;
}

function sentRequest(call = 0) {
  const [url, init] = fetchMock.mock.calls[call];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
}

// A response the test settles by hand, to interleave two requests.
function deferredResponse() {
  let resolve!: (response: Promise<Response>) => void;
  const response = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { response, resolve };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
  process.env.EXPO_PUBLIC_API_URL = API_URL;
  useInventoryStore.setState({
    items: [RICE, MILK],
    ingredients: INGREDIENTS,
    loadStatus: 'idle',
    loadError: null,
  });
});

afterAll(() => {
  process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
});

describe('initial state', () => {
  it('holds no items until the API is read', () => {
    expect(useInventoryStore.getInitialState()).toMatchObject({
      items: [],
      loadStatus: 'idle',
      loadError: null,
    });
  });

  it('keeps the ingredient catalog', () => {
    expect(useInventoryStore.getInitialState().ingredients).toEqual(MOCK_INGREDIENTS);
  });
});

describe('refresh', () => {
  it('replaces the cache with the lots of the read, what to use first coming first', async () => {
    fetchMock.mockReturnValueOnce(dataResponse(INVENTORY_VIEW));

    await useInventoryStore.getState().refresh();

    expect(sentRequest()).toEqual({ url: `${API_URL}/api/inventory`, method: 'GET' });
    expect(getItems()).toEqual([CHICKEN, MILK, RICE, ONION, STEW]);
    expect(useInventoryStore.getState()).toMatchObject({ loadStatus: 'ready', loadError: null });
  });

  it('is loading while the read is on its way', async () => {
    const { response, resolve } = deferredResponse();
    fetchMock.mockReturnValueOnce(response);

    const reading = useInventoryStore.getState().refresh();

    expect(useInventoryStore.getState().loadStatus).toBe('loading');

    resolve(dataResponse(INVENTORY_VIEW));
    await reading;

    expect(useInventoryStore.getState().loadStatus).toBe('ready');
  });

  it('keeps the cache and holds the envelope error when the read fails', async () => {
    fetchMock.mockReturnValueOnce(errorResponse('account_expired', 'Account expired', 403));

    await useInventoryStore.getState().refresh();

    expect(getItems()).toEqual([RICE, MILK]);
    expect(useInventoryStore.getState().loadStatus).toBe('error');
    expect(useInventoryStore.getState().loadError).toMatchObject({ code: 'account_expired' });
  });

  it('clears the error of a failed read when the next one succeeds', async () => {
    fetchMock
      .mockReturnValueOnce(errorResponse('account_expired', 'Account expired', 403))
      .mockReturnValueOnce(dataResponse(INVENTORY_VIEW));

    await useInventoryStore.getState().refresh();
    await useInventoryStore.getState().refresh();

    expect(useInventoryStore.getState()).toMatchObject({ loadStatus: 'ready', loadError: null });
  });

  it('ignores the answer of a read that a newer one replaced', async () => {
    const stale = deferredResponse();
    fetchMock
      .mockReturnValueOnce(stale.response)
      .mockReturnValueOnce(
        dataResponse({ ...INVENTORY_VIEW, sections: { ok: [ONION], warning: [], expired: [] } })
      );

    const staleRead = useInventoryStore.getState().refresh();
    await useInventoryStore.getState().refresh();
    stale.resolve(dataResponse(INVENTORY_VIEW));
    await staleRead;

    expect(getItems()).toEqual([ONION]);
    expect(useInventoryStore.getState().loadStatus).toBe('ready');
  });

  it('reads again when a write landed while the read was on its way', async () => {
    const stale = deferredResponse();
    const emptiedRice = { ...RICE, quantityMilli: 0 };
    fetchMock
      .mockReturnValueOnce(stale.response)
      .mockReturnValueOnce(
        dataResponse({ item: emptiedRice, mutationEvent: mutationEvent(emptiedRice) })
      )
      .mockReturnValueOnce(
        dataResponse({ ...INVENTORY_VIEW, sections: { ok: [ONION], warning: [], expired: [] } })
      );

    const staleRead = useInventoryStore.getState().refresh();
    await useInventoryStore.getState().setQuantity(RICE.id, 0);
    // Answered before the write: it still lists the rice.
    stale.resolve(dataResponse(INVENTORY_VIEW));
    await staleRead;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getItems()).toEqual([ONION]);
    expect(useInventoryStore.getState().loadStatus).toBe('ready');
  });
});

describe('addExtra', () => {
  const payload = { ingredientName: 'Cebolla', quantityMilli: 3_000, unit: 'unit' } as const;

  it('sends the item and appends the lot the API answers', async () => {
    fetchMock.mockReturnValueOnce(
      dataResponse({ item: ONION, mutationEvent: mutationEvent(ONION, { operation: 'add' }) })
    );

    await expect(useInventoryStore.getState().addExtra(payload)).resolves.toEqual(ONION);

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/items/add-extra`,
      method: 'POST',
      body: payload,
    });
    expect(getItems()).toEqual([RICE, MILK, ONION]);
  });

  it('replaces the cached lot when the add accumulated in it', async () => {
    const accumulated = { ...RICE, quantityMilli: 2_000_000 };
    fetchMock.mockReturnValueOnce(
      dataResponse({ item: accumulated, mutationEvent: mutationEvent(accumulated) })
    );

    await useInventoryStore
      .getState()
      .addExtra({ ingredientId: RICE.ingredientId, quantityMilli: 500_000, unit: 'g' });

    expect(getItems()).toEqual([accumulated, MILK]);
  });

  it('leaves the cache untouched and rejects with the envelope error when it fails', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('validation_error', 'The request data is not valid.', 422)
    );
    const itemsBefore = getItems();

    await expect(useInventoryStore.getState().addExtra(payload)).rejects.toMatchObject({
      code: 'validation_error',
    });

    expect(getItems()).toBe(itemsBefore);
  });
});

describe('setQuantity', () => {
  it('sends the quantity in thousandths and replaces the lot with the answer', async () => {
    const updated: InventoryItem = { ...RICE, quantityMilli: 250_000, freshness: 'warning' };
    fetchMock.mockReturnValueOnce(
      dataResponse({ item: updated, mutationEvent: mutationEvent(updated) })
    );

    await useInventoryStore.getState().setQuantity(RICE.id, 250_000);

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/items/${RICE.id}/quantity`,
      method: 'POST',
      body: { quantityMilli: 250_000 },
    });
    expect(getItems()).toEqual([updated, MILK]);
  });

  it('removes the lot when it is set to zero', async () => {
    const emptied = { ...RICE, quantityMilli: 0 };
    fetchMock.mockReturnValueOnce(
      dataResponse({ item: emptied, mutationEvent: mutationEvent(emptied) })
    );

    await useInventoryStore.getState().setQuantity(RICE.id, 0);

    expect(getItems()).toEqual([MILK]);
  });

  it('leaves the cache untouched and rejects with the envelope error when it fails', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('validation_error', 'The request data is not valid.', 422)
    );
    const itemsBefore = getItems();

    await expect(useInventoryStore.getState().setQuantity(RICE.id, -1)).rejects.toMatchObject({
      code: 'validation_error',
    });

    expect(getItems()).toBe(itemsBefore);
  });

  it('does not touch the load status, which belongs to the read', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('inventory_item_not_found', 'Inventory item not found', 404)
    );
    useInventoryStore.setState({ loadStatus: 'ready' });

    await useInventoryStore
      .getState()
      .setQuantity(RICE.id, 1000)
      .catch(() => undefined);

    expect(useInventoryStore.getState()).toMatchObject({ loadStatus: 'ready', loadError: null });
  });
});

describe('dispose', () => {
  it('disposes of the lot through the API and removes it from the cache', async () => {
    fetchMock.mockReturnValueOnce(
      dataResponse({ disposed: true, mutationEvent: mutationEvent(RICE, { operation: 'delete' }) })
    );

    await useInventoryStore.getState().dispose(RICE.id);

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/items/${RICE.id}/dispose`,
      method: 'POST',
    });
    expect(getItems()).toEqual([MILK]);
  });

  it('leaves the cache untouched and rejects with the envelope error when it fails', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('inventory_item_not_found', 'Inventory item not found', 404)
    );
    const itemsBefore = getItems();

    await expect(useInventoryStore.getState().dispose(RICE.id)).rejects.toMatchObject({
      code: 'inventory_item_not_found',
    });

    expect(getItems()).toBe(itemsBefore);
  });
});

describe('applyVoice', () => {
  const payload = {
    transcript: VOICE_TRANSCRIPT_HIGH,
    intent: VOICE_PREVIEW_HIGH_CONFIDENCE.intent,
    confirmed: false,
  };

  it('applies the intent through the API and patches the lot with the quantity after it', async () => {
    fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT));

    await useInventoryStore.getState().applyVoice(payload);

    expect(sentRequest()).toEqual({
      url: `${API_URL}/api/inventory/voice/apply`,
      method: 'POST',
      body: payload,
    });
    expect(getItems()).toEqual([{ ...RICE, quantityMilli: 1_000_000 }, MILK]);
  });

  it('removes a lot the intent emptied', async () => {
    fetchMock.mockReturnValueOnce(
      dataResponse({
        ...VOICE_APPLY_RESULT,
        mutationEvents: [mutationEvent(RICE, { operation: 'subtract', quantityAfterMilli: 0 })],
      })
    );

    await useInventoryStore.getState().applyVoice(payload);

    expect(getItems()).toEqual([MILK]);
  });

  it('ignores the events of lots the cache does not hold', async () => {
    fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT));
    useInventoryStore.setState({ items: [MILK] });

    await useInventoryStore.getState().applyVoice(payload);

    expect(getItems()).toEqual([MILK]);
  });

  it('leaves the cache untouched and rejects with the envelope error when it fails', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('voice_confirmation_required', 'Confirmation required', 422)
    );
    const itemsBefore = getItems();

    await expect(useInventoryStore.getState().applyVoice(payload)).rejects.toMatchObject({
      code: 'voice_confirmation_required',
    });

    expect(getItems()).toBe(itemsBefore);
  });

  it('discards a read that was on its way during the write', async () => {
    const { response, resolve } = deferredResponse();
    fetchMock.mockReturnValueOnce(response);
    const read = useInventoryStore.getState().refresh();
    fetchMock.mockReturnValueOnce(dataResponse(VOICE_APPLY_RESULT));
    await useInventoryStore.getState().applyVoice(payload);
    // The stale read answers with the stock before the write; the store reads again
    fetchMock.mockReturnValueOnce(
      dataResponse({
        ...INVENTORY_VIEW,
        sections: { ok: [{ ...RICE, quantityMilli: 1_000_000 }], warning: [], expired: [] },
      })
    );
    resolve(dataResponse(INVENTORY_VIEW));
    await read;

    expect(getItems()).toEqual([{ ...RICE, quantityMilli: 1_000_000 }]);
  });
});

describe('consumeIngredient', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [RICE_LOT] });
  });

  it('subtracts the consumed thousandths, without calling the API', () => {
    useInventoryStore.getState().consumeIngredient('rice', 200_000);

    expect(getItems()).toEqual([{ ...RICE_LOT, quantityMilli: 300_000 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes the lot when more than the stock is consumed', () => {
    useInventoryStore.getState().consumeIngredient('rice', 900_000);

    expect(getItems()).toEqual([]);
  });

  it('ignores an ingredient that is not in the inventory', () => {
    useInventoryStore.getState().consumeIngredient('milk', 100_000);

    expect(getItems()).toEqual([RICE_LOT]);
  });
});

describe('migrateInventoryState', () => {
  it('discards the fixture items persisted before the store read the API', () => {
    const persisted = {
      items: [
        {
          id: 'inv-i1',
          ingredientId: 'i1',
          name: 'Arroz Blanco',
          category: 'almacen',
          quantity: 500,
          unit: 'g',
          confidence: 'estimated',
        },
      ],
      ingredients: MOCK_INGREDIENTS,
    };

    expect(migrateInventoryState(persisted, 1)).toEqual({
      items: [],
      ingredients: MOCK_INGREDIENTS,
    });
  });

  it('discards the items of an unversioned payload and its retired catalog', () => {
    const persisted = {
      items: [{ ingredientId: 'i1', amount: 500 }],
      ingredients: [
        { id: 'i1', name: 'Arroz', category: 'despensa', basePrice: 2, unit: 'gramos' },
      ],
    };

    expect(migrateInventoryState(persisted, 0)).toEqual({
      items: [],
      ingredients: MOCK_INGREDIENTS,
    });
  });

  it('starts with an empty inventory when nothing was persisted', () => {
    expect(migrateInventoryState(null, 0)).toEqual({ items: [], ingredients: MOCK_INGREDIENTS });
  });

  it('keeps a payload that is already on the current version', () => {
    const persisted = { items: [RICE], ingredients: INGREDIENTS };

    expect(migrateInventoryState(persisted, 2)).toEqual(persisted);
  });
});
