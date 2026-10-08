import { FALLBACK_CATEGORY, SHOPPING_CATEGORIES, SHOPPING_CATEGORY_LABELS } from '../constants';
import type { ShoppingGroup, ShoppingListLine } from '../types';

// Lines still on the list; a removed one never reaches a group. Sorted by name so a change in
// the plan never reorders the rows of a group. Lines of the same name, the ones an ingredient
// has per meal, keep the order of the read: the order of their meals.
function getVisibleLines(lines: ShoppingListLine[]) {
  return lines
    .filter((line) => line.status !== 'removed')
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getGroupCategory({ category }: ShoppingListLine) {
  return SHOPPING_CATEGORIES.includes(category) ? category : FALLBACK_CATEGORY;
}

// One group per category that has lines, in the order the categories are listed everywhere.
// The lines are grouped the same way whether they are read per ingredient or per meal.
export function groupItemsByCategory(lines: ShoppingListLine[]): ShoppingGroup[] {
  const visibleLines = getVisibleLines(lines);

  return SHOPPING_CATEGORIES.map((category) => ({
    key: category,
    title: SHOPPING_CATEGORY_LABELS[category],
    items: visibleLines.filter((line) => getGroupCategory(line) === category),
  })).filter((group) => group.items.length > 0);
}
