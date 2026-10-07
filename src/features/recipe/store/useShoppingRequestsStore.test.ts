import { selectRequestedIngredientIds, useShoppingRequestsStore } from './useShoppingRequestsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const store = () => useShoppingRequestsStore.getState();

beforeEach(() => {
  useShoppingRequestsStore.setState({ requests: [] });
});

describe('requestIngredient', () => {
  it('adds a request for a catalog ingredient', () => {
    store().requestIngredient({
      name: 'Pollo (pechuga)',
      ingredientId: 'i2',
      amount: 200,
      unit: 'g',
    });

    expect(store().requests).toHaveLength(1);
    expect(store().requests[0]).toMatchObject({
      name: 'Pollo (pechuga)',
      ingredientId: 'i2',
      amount: 200,
      unit: 'g',
    });
  });

  it('gives every request its own id and a creation date', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });
    store().requestIngredient({ name: 'Pan rallado' });

    const [first, second] = store().requests;

    expect(first.id).not.toBe(second.id);
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
  });

  it('keeps the requests in the order they were made', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });
    store().requestIngredient({ name: 'Pan rallado' });
    store().requestIngredient({ name: 'Espinaca', ingredientId: 'i7' });

    expect(store().requests.map((request) => request.name)).toEqual([
      'Tomate',
      'Pan rallado',
      'Espinaca',
    ]);
  });

  it('stores the name trimmed', () => {
    store().requestIngredient({ name: '  Pan rallado  ' });

    expect(store().requests[0].name).toBe('Pan rallado');
  });

  it('ignores a request with a blank name and no ingredient', () => {
    store().requestIngredient({ name: '   ' });

    expect(store().requests).toEqual([]);
  });
});

describe('requestIngredient for an ingredient that was already requested', () => {
  it('keeps a single request for the ingredient', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });

    expect(store().requests).toHaveLength(1);
  });

  it('raises the amount when the new request asks for more', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 5, unit: 'unit' });

    expect(store().requests[0].amount).toBe(5);
  });

  it('keeps the amount when the new request asks for less', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 5, unit: 'unit' });
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });

    expect(store().requests[0].amount).toBe(5);
  });

  it('takes the amount of the new request when the first one had none', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });

    expect(store().requests[0]).toMatchObject({ amount: 2, unit: 'unit' });
  });

  it('keeps the amount when the new request has none', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2, unit: 'unit' });
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });

    expect(store().requests[0]).toMatchObject({ amount: 2, unit: 'unit' });
  });

  it('keeps the identity and position of the first request', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2 });
    store().requestIngredient({ name: 'Espinaca', ingredientId: 'i7', amount: 100 });
    const { id, createdAt } = store().requests[0];

    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 9 });

    expect(store().requests.map((request) => request.ingredientId)).toEqual(['i3', 'i7']);
    expect(store().requests[0]).toMatchObject({ id, createdAt, amount: 9 });
  });

  it('keeps separate requests for different ingredients', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2 });
    store().requestIngredient({ name: 'Espinaca', ingredientId: 'i7', amount: 100 });

    expect(store().requests).toHaveLength(2);
  });
});

describe('requestIngredient without an ingredient id', () => {
  it('keeps a single request for the same name, ignoring case and spaces', () => {
    store().requestIngredient({ name: 'Pan rallado' });
    store().requestIngredient({ name: '  pan RALLADO ' });

    expect(store().requests).toHaveLength(1);
    expect(store().requests[0].name).toBe('Pan rallado');
  });

  it('keeps separate requests for different names', () => {
    store().requestIngredient({ name: 'Pan rallado' });
    store().requestIngredient({ name: 'Pan' });

    expect(store().requests).toHaveLength(2);
  });

  it('keeps the larger amount of a repeated name', () => {
    store().requestIngredient({ name: 'Pan rallado', amount: 100, unit: 'g' });
    store().requestIngredient({ name: 'pan rallado', amount: 250, unit: 'g' });

    expect(store().requests[0].amount).toBe(250);
  });

  it('does not merge a named request into a catalog ingredient with the same name', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2 });
    store().requestIngredient({ name: 'tomate' });

    expect(store().requests).toHaveLength(2);
  });
});

describe('removeRequest', () => {
  it('removes only the request with that id', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });
    store().requestIngredient({ name: 'Pan rallado' });
    const [tomato] = store().requests;

    store().removeRequest(tomato.id);

    expect(store().requests.map((request) => request.name)).toEqual(['Pan rallado']);
  });

  it('leaves the requests untouched for an unknown id', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });

    store().removeRequest('nope');

    expect(store().requests).toHaveLength(1);
  });

  it('lets a removed ingredient be requested again', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 5 });
    store().removeRequest(store().requests[0].id);

    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3', amount: 2 });

    expect(store().requests).toHaveLength(1);
    expect(store().requests[0].amount).toBe(2);
  });
});

describe('clearRequests', () => {
  it('removes every request', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });
    store().requestIngredient({ name: 'Pan rallado' });

    store().clearRequests();

    expect(store().requests).toEqual([]);
  });
});

describe('selectRequestedIngredientIds', () => {
  it('returns the catalog ids of the requests, skipping the ones without an id', () => {
    store().requestIngredient({ name: 'Tomate', ingredientId: 'i3' });
    store().requestIngredient({ name: 'Pan rallado' });
    store().requestIngredient({ name: 'Espinaca', ingredientId: 'i7' });

    expect(selectRequestedIngredientIds(store())).toEqual(['i3', 'i7']);
  });

  it('returns nothing when there are no requests', () => {
    expect(selectRequestedIngredientIds({ requests: [] })).toEqual([]);
  });
});

describe('persistence', () => {
  it('persists under the shopping requests storage key', () => {
    expect(useShoppingRequestsStore.persist.getOptions().name).toBe('shopping-requests-storage');
  });
});
