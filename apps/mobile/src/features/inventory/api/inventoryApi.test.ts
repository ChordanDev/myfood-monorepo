import { isApiError } from '@/api/errors';
import { INVENTORY_VIEW, MILK, RICE, dataResponse, errorResponse, mutationEvent } from '../mocks';
import { addExtraItem, disposeItem, getInventory, setItemQuantity } from './inventoryApi';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve('access-1')),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const API_URL = 'https://api.example.test';

describe('inventoryApi', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.EXPO_PUBLIC_API_URL = API_URL;
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  });

  function sentBody() {
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it('reads the inventory view with the bearer token and unwraps it', async () => {
    fetchMock.mockReturnValueOnce(dataResponse(INVENTORY_VIEW));

    await expect(getInventory()).resolves.toEqual(INVENTORY_VIEW);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/inventory`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
  });

  it('adds an extra item and answers the resulting lot with its mutation event', async () => {
    const written = { item: MILK, mutationEvent: mutationEvent(MILK, { operation: 'add' }) };
    fetchMock.mockReturnValueOnce(dataResponse(written));

    const payload = {
      ingredientName: 'Leche',
      quantityMilli: 750_000,
      unit: 'ml',
      expiresAt: '2026-10-10',
      notes: 'Abierta',
      isLeftover: false,
    } as const;

    await expect(addExtraItem(payload)).resolves.toEqual(written);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/inventory/items/add-extra`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
      })
    );
    expect(sentBody()).toEqual(payload);
  });

  it('sets the quantity of a lot in thousandths', async () => {
    const item = { ...RICE, quantityMilli: 250_000 };
    const written = { item, mutationEvent: mutationEvent(item) };
    fetchMock.mockReturnValueOnce(dataResponse(written));

    await expect(setItemQuantity(RICE.id, 250_000)).resolves.toEqual(written);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/inventory/items/${RICE.id}/quantity`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(sentBody()).toEqual({ quantityMilli: 250_000 });
  });

  it('disposes of a lot', async () => {
    const disposed = {
      disposed: true,
      mutationEvent: mutationEvent(RICE, { operation: 'delete' }),
    };
    fetchMock.mockReturnValueOnce(dataResponse(disposed));

    await expect(disposeItem(RICE.id)).resolves.toEqual(disposed);

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/api/inventory/items/${RICE.id}/dispose`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('escapes the item id it puts in the path', async () => {
    fetchMock.mockReturnValueOnce(errorResponse('inventory_item_not_found', 'Not found', 404));

    await expect(disposeItem('inv/i 1')).rejects.toMatchObject({
      code: 'inventory_item_not_found',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${API_URL}/api/inventory/items/inv%2Fi%201/dispose`);
  });

  it('rejects with the envelope error of a failed request', async () => {
    fetchMock.mockReturnValueOnce(
      errorResponse('validation_error', 'The request data is not valid.', 422)
    );

    const error = await setItemQuantity(RICE.id, -1).catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'validation_error', status: 422 });
  });

  it.each([
    ['an empty body', null],
    ['a body without data', { item: RICE }],
    ['a view without its sections', { data: { totals: INVENTORY_VIEW.totals } }],
  ])('rejects %s of a successful answer as unintelligible', async (_label, body) => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(body === null ? '' : JSON.stringify(body)),
      } as Response)
    );

    await expect(getInventory()).rejects.toMatchObject({ code: 'unknown_error' });
  });
});
