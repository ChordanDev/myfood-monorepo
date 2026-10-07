import type { IngredientCategory } from '@/types/domain';

// Fixed, palette-independent category colors: a category keeps its color under every meal
// palette. The only color literals of this kind allowed in the app, see docs/THEMING.md.
// verduras, carnes, lacteos, almacen and congelados come from the mockup; the other seven are
// provisional and pending design review.
export const INVENTORY_CATEGORY_COLORS: Record<IngredientCategory, string> = {
  verduras: '#B9BE98',
  frutas: '#E8BE9C',
  carnes: '#D4A38F',
  pescados_mariscos: '#A6C2B8',
  lacteos: '#D9CBB0',
  panaderia: '#CFB592',
  almacen: '#E3D898',
  congelados: '#B8C4C6',
  bebidas: '#BDB7D2',
  condimentos: '#C4AE74',
  limpieza_otros: '#A9BBD3',
  otros: '#C6C2B6',
};
