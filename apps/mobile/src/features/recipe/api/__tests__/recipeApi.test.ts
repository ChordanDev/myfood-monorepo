import { ACCESS_TOKEN_KEY } from '@/api/authTokenStore';
import { ApiError } from '@/api/errors';
import recipeDetail from '../../fixtures/recipeDetail.json';
import {
  RECIPE_INGREDIENT_CATEGORIES,
  RECIPE_SOURCES,
  RECIPE_UNITS,
  type Recipe,
} from '../../types/recipe';
import { getRecipe } from '../recipeApi';

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

function mockJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 422) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as Response);
}

function oneOf<T extends string>(allowed: readonly T[], value: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new Error(`Unexpected fixture value: ${value}`);
  return match;
}

// A JSON import types its strings as `string`, so the union fields are narrowed here. Every
// other field of the frozen payload is checked against `Recipe` by the compiler.
function fixtureRecipe(): Recipe {
  const { data } = recipeDetail;

  return {
    ...data,
    source: oneOf(RECIPE_SOURCES, data.source),
    ingredients: data.ingredients.map((line) => ({
      ...line,
      category: oneOf(RECIPE_INGREDIENT_CATEGORIES, line.category),
      unit: oneOf(RECIPE_UNITS, line.unit),
    })),
  };
}

describe('getRecipe', () => {
  const fetchMock = jest.fn();
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const recipe = fixtureRecipe();

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

  it('GETs /api/recipes/:id with the stored bearer token and returns the unwrapped recipe', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(recipeDetail));

    const result = await getRecipe(recipe.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.test/api/recipes/${recipe.id}`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-1',
          Accept: 'application/json',
        }),
      })
    );
    expect(result).toEqual(recipe);
  });

  it('URL-encodes the recipe id', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse(recipeDetail));

    await getRecipe('meal/1 a');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/recipes/meal%2F1%20a',
      expect.anything()
    );
  });

  it('rejects with the recipe_not_found ApiError on a 404 envelope', async () => {
    fetchMock.mockReturnValueOnce(
      mockJsonResponse(
        { error: { code: 'recipe_not_found', message: 'Recipe not found' } },
        false,
        404
      )
    );

    const error = await getRecipe(recipe.id).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'recipe_not_found', status: 404 });
  });

  it('rejects a 2xx answer that carries no recipe', async () => {
    fetchMock.mockReturnValueOnce(mockJsonResponse({ data: null }));

    await expect(getRecipe(recipe.id)).rejects.toMatchObject({ code: 'unknown_error' });
  });
});
