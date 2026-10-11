import {
  MANUAL_DISH_SOAP,
  OLIVE_OIL_LINE_ID,
  RICE_LINE_ID,
  RICE_NEEDED_ITEM_IDS,
  SHOPPING_LIST_AFTER_PURCHASE,
  SHOPPING_LIST_BY_INGREDIENT,
  SHOPPING_LIST_BY_MEAL,
  SHOPPING_LIST_UNTIL_OCT_10,
  SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE,
  SHOPPING_LIST_WITH_CART_OUT_OF_RANGE,
} from '../fixtures';
import type { ShoppingCartLine } from '../types';
import { getCartLines, getChangedCheckoutLines, getItemIdsToBuy } from './shoppingCart';

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
  it('lists the lines of the Cart as the read reports them, however the list is read', () => {
    expect(getCartLines(SHOPPING_LIST_BY_INGREDIENT)).toEqual([OIL_IN_CART, RICE_IN_CART]);
    expect(getCartLines(SHOPPING_LIST_BY_MEAL)).toEqual([OIL_IN_CART, RICE_IN_CART]);
    expect(getCartLines(SHOPPING_LIST_UNTIL_OCT_10)).toEqual([OIL_IN_CART, RICE_IN_CART]);
  });

  it('takes the total of a line from the Cart, not from the shares the read lists', () => {
    const [rice] = SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE.planned;

    // The date limit leaves 400 g of the rice on the list; a confirm buys the 1250 g.
    expect(rice.quantityMilli).toBe(400_000);
    expect(getCartLines(SHOPPING_LIST_WITH_CART_LINE_BEYOND_RANGE)).toEqual([
      { ...RICE_IN_CART, quantityMilli: 1_250_000 },
    ]);
  });

  it('lists a line of the Cart the read has no share of', () => {
    expect(SHOPPING_LIST_WITH_CART_OUT_OF_RANGE.totals.inCart).toBe(0);
    expect(getCartLines(SHOPPING_LIST_WITH_CART_OUT_OF_RANGE).map(({ name }) => name)).toEqual([
      'Leche',
      'Banana',
    ]);
  });

  it('leaves out a share in the Cart of another member', () => {
    const [rice, chicken, ...others] = SHOPPING_LIST_BY_INGREDIENT.planned;
    const chickenInTheirCart = {
      ...chicken,
      status: 'in_cart' as const,
      allocations: chicken.allocations.map((share) => ({ ...share, status: 'in_cart' as const })),
    };
    const soapInTheirCart = { ...MANUAL_DISH_SOAP, status: 'in_cart' as const };

    expect(
      getCartLines({
        ...SHOPPING_LIST_BY_INGREDIENT,
        planned: [rice, chickenInTheirCart, ...others],
        manual: [soapInTheirCart],
      })
    ).toEqual([OIL_IN_CART, RICE_IN_CART]);
  });

  it('has no line for a Cart that holds nothing, without a Cart, or before a list was read', () => {
    const emptyCart = { ...SHOPPING_LIST_BY_INGREDIENT.cart!, lines: [] };

    expect(getCartLines({ ...SHOPPING_LIST_BY_INGREDIENT, cart: emptyCart })).toEqual([]);
    expect(getCartLines(SHOPPING_LIST_AFTER_PURCHASE)).toEqual([]);
    expect(getCartLines(null)).toEqual([]);
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
