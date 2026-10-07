// Public surface of the shopping feature. Internal modules import each other by relative path.
export { ShoppingScreen } from './screens';

// For a feature that shows whether an ingredient is on the list, or puts it there.
export { getIngredientListState, type IngredientListState, type ListedIngredient } from './domain';
export { useShoppingListItems } from './hooks/useShoppingListItems';
export { addIngredientToShoppingList } from './store';
export type { ShoppingListItem } from './types';
