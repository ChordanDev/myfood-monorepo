import {
  MANUAL_DISH_SOAP,
  OLIVE_OIL_LINE_ID,
  RICE_LINE_ID,
  RICE_NEEDED_ITEM_IDS,
  SHOPPING_LIST_AFTER_PURCHASE,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_WITH_CART_OUT_OF_RANGE,
} from '../fixtures';
import type { ShoppingCartLine, ShoppingListRead } from '../types';
import {
  getCartLines,
  getChangedCheckoutLines,
  getHiddenCartItemsCount,
  getItemIdsToBuy,
} from './shoppingCart';

const RICE_IN_CART: ShoppingCartLine = {
  id: RICE_LINE_ID,
  name: 'Arroz',
  unit: 'g',
  quantityMilli: 400_000,
};
const OIL_IN_CART: ShoppingCartLine = {
  id: OLIVE_OIL_LINE_ID,
  name: 'Aceite de oliva',
  unit: 'ml',
  quantityMilli: 30_000,
};

describe('getCartLines', () => {
  it('lists what is in a Cart per ingredient, with only the shares that are in it', () => {
    // Only one of the three shares of the rice is in the Cart.
    expect(getCartLines(SHOPPING_LIST_BY_INGREDIENT)).toEqual([RICE_IN_CART, OIL_IN_CART]);
  });

  it('names a line by its ingredient and unit when the list is read per meal', () => {
    // Per meal the id of a line is the id of a Shopping item, which a confirm refuses.
    expect(getCartLines(SHOPPING_LIST_BY_MEAL)).toEqual([RICE_IN_CART, OIL_IN_CART]);
  });

  it('adds up the shares of an ingredient that are in the Cart', () => {
    const [rice, ...others] = SHOPPING_LIST_BY_INGREDIENT.planned;
    const allInCart = {
      ...rice,
      status: 'in_cart' as const,
      allocations: rice.allocations.map((share) => ({ ...share, status: 'in_cart' as const })),
    };

    expect(
      getCartLines({ ...SHOPPING_LIST_BY_INGREDIENT, planned: [allInCart, ...others] })
    ).toEqual([{ ...RICE_IN_CART, quantityMilli: 1_250_000 }, OIL_IN_CART]);
  });

  it('lists an item added by hand that is in the Cart by its own id', () => {
    const soapInCart = { ...MANUAL_DISH_SOAP, status: 'in_cart' as const };

    expect(
      getCartLines({ ...SHOPPING_LIST_AFTER_PURCHASE, manual: [MANUAL_DISH_SOAP, soapInCart] })
    ).toEqual([{ id: soapInCart.id, name: 'Detergente', unit: 'unit', quantityMilli: 1_000 }]);
  });

  it('has no line once the Cart was bought, or before a list was read', () => {
    expect(getCartLines(SHOPPING_LIST_AFTER_PURCHASE)).toEqual([]);
    expect(getCartLines(null)).toEqual([]);
  });
});

describe('getHiddenCartItemsCount', () => {
  const withItemsCount = (list: ShoppingListRead, itemsCount: number): ShoppingListRead => ({
    ...list,
    cart: { ...list.cart!, itemsCount },
  });

  it('is zero while the read lists every item of the Cart, however it is grouped', () => {
    expect(getHiddenCartItemsCount(SHOPPING_LIST_BY_INGREDIENT)).toBe(0);
    expect(getHiddenCartItemsCount(SHOPPING_LIST_BY_MEAL)).toBe(0);
    expect(getHiddenCartItemsCount(SHOPPING_LIST_UNTIL_OCT_10)).toBe(0);
  });

  it('is zero without a Cart, and before a list was read', () => {
    expect(getHiddenCartItemsCount(SHOPPING_LIST_AFTER_PURCHASE)).toBe(0);
    expect(getHiddenCartItemsCount(null)).toBe(0);
  });

  it('is every item of the Cart when the date limit leaves all of them out', () => {
    expect(getHiddenCartItemsCount(SHOPPING_LIST_WITH_CART_OUT_OF_RANGE)).toBe(2);
  });

  it('is what the Cart holds beyond the items the read lists as in a Cart', () => {
    // The rice and the oil of the 8th are listed; three more are for later meals.
    expect(getHiddenCartItemsCount(withItemsCount(SHOPPING_LIST_UNTIL_OCT_10, 5))).toBe(3);
    expect(getHiddenCartItemsCount(withItemsCount(SHOPPING_LIST_BY_MEAL, 3))).toBe(1);
  });

  it('counts an item added by hand that is in the Cart as listed', () => {
    const soapInCart = { ...MANUAL_DISH_SOAP, status: 'in_cart' as const };
    const list = { ...SHOPPING_LIST_BY_INGREDIENT, manual: [MANUAL_DISH_SOAP, soapInCart] };

    expect(getHiddenCartItemsCount(withItemsCount(list, 3))).toBe(0);
    expect(getHiddenCartItemsCount(withItemsCount(list, 4))).toBe(1);
  });

  it('is never below zero: the shares in the Cart of another member are listed too', () => {
    expect(getHiddenCartItemsCount(withItemsCount(SHOPPING_LIST_BY_INGREDIENT, 1))).toBe(0);
    expect(getHiddenCartItemsCount(withItemsCount(SHOPPING_LIST_BY_INGREDIENT, 0))).toBe(0);
  });
});

describe('getChangedCheckoutLines', () => {
  const lines = [RICE_IN_CART, OIL_IN_CART];

  it('sends nothing while every line is bought as the Cart holds it', () => {
    expect(
      getChangedCheckoutLines(lines, { [RICE_LINE_ID]: 400_000, [OLIVE_OIL_LINE_ID]: 30_000 })
    ).toEqual([]);
    expect(getChangedCheckoutLines(lines, {})).toEqual([]);
  });

  it('sends only the lines bought at another quantity: less, more or none', () => {
    expect(getChangedCheckoutLines(lines, { [RICE_LINE_ID]: 250_000 })).toEqual([
      { itemId: RICE_LINE_ID, quantityMilli: 250_000 },
    ]);
    expect(
      getChangedCheckoutLines(lines, { [RICE_LINE_ID]: 1_000_000, [OLIVE_OIL_LINE_ID]: 0 })
    ).toEqual([
      { itemId: RICE_LINE_ID, quantityMilli: 1_000_000 },
      { itemId: OLIVE_OIL_LINE_ID, quantityMilli: 0 },
    ]);
  });
});

describe('getItemIdsToBuy', () => {
  const lineNamed = (name: string, list = SHOPPING_LIST_AFTER_PURCHASE) =>
    list.planned.find((line) => line.name === name)!;

  it('is every share of a line that is all still to buy', () => {
    expect(getItemIdsToBuy(lineNamed('Tomate'))).toHaveLength(2);
  });

  it('leaves out the shares that were bought: one of them fails the whole marking', () => {
    expect(getItemIdsToBuy(lineNamed('Arroz'))).toEqual(RICE_NEEDED_ITEM_IDS);
  });

  it('leaves out the shares already in a Cart', () => {
    expect(getItemIdsToBuy(lineNamed('Arroz', SHOPPING_LIST_BY_INGREDIENT))).toHaveLength(2);
  });

  it('is nothing for a purchased line', () => {
    expect(getItemIdsToBuy(lineNamed('Aceite de oliva'))).toEqual([]);
  });
});
