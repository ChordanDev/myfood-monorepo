import { INGREDIENT_CATEGORIES } from '@/types/domain';
import { INVENTORY_CATEGORIES } from '../types';
import { toDisplayCategory } from './inventoryCategory';

describe('toDisplayCategory', () => {
  it.each([
    ['lacteos', 'lacteos'],
    ['frutas', 'frutas'],
    ['verduras', 'verduras'],
    ['carnes', 'carnes'],
    ['granos', 'almacen'],
    ['congelados', 'congelados'],
    ['no_perecederos', 'almacen'],
    ['otros', 'otros'],
  ])('shows the API category "%s" as "%s"', (category, expected) => {
    expect(toDisplayCategory(category)).toBe(expected);
  });

  it('maps every category of the API to a display category', () => {
    for (const category of INVENTORY_CATEGORIES) {
      expect(INGREDIENT_CATEGORIES).toContain(toDisplayCategory(category));
    }
  });

  it.each(['bebidas_nuevas', '', 'toString', 'constructor'])(
    'falls back to the generic category for the unknown value "%s"',
    (category) => {
      expect(toDisplayCategory(category)).toBe('otros');
    }
  );
});
