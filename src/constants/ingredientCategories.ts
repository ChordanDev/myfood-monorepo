import type { IngredientCategory } from '@/types/domain';

// Spanish label of every ingredient category. The display order is `INGREDIENT_CATEGORIES`.
export const INGREDIENT_CATEGORY_LABELS: Record<IngredientCategory, string> = {
  verduras: 'Verduras',
  frutas: 'Frutas',
  carnes: 'Carnes',
  pescados_mariscos: 'Pescados y mariscos',
  lacteos: 'Lácteos',
  panaderia: 'Panadería',
  almacen: 'Despensa',
  congelados: 'Congelados',
  bebidas: 'Bebidas',
  condimentos: 'Condimentos',
  limpieza_otros: 'Limpieza y otros',
  otros: 'Otros',
};
