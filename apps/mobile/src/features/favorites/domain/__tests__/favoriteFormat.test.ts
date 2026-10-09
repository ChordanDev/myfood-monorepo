import {
  favoriteSummaryFromRecipe,
  formatFavoriteDuration,
  formatFavoriteIngredients,
} from '../favoriteFormat';

describe('formatFavoriteDuration', () => {
  it.each([
    [40, '40 min'],
    [60, '1 h'],
    [90, '1 h 30 min'],
    [125, '2 h 5 min'],
  ])('reads %i minutes as %s', (minutes, label) => {
    expect(formatFavoriteDuration(minutes)).toBe(label);
  });

  it('states nothing for an unknown or empty duration', () => {
    expect(formatFavoriteDuration(null)).toBeNull();
    expect(formatFavoriteDuration(0)).toBeNull();
  });
});

describe('formatFavoriteIngredients', () => {
  it('joins the ingredients and states nothing without them', () => {
    expect(formatFavoriteIngredients(['Papa', 'Huevo'])).toBe('Papa, Huevo');
    expect(formatFavoriteIngredients([])).toBeNull();
  });
});

describe('favoriteSummaryFromRecipe', () => {
  it('keeps the name and duration and the first three ingredients', () => {
    expect(
      favoriteSummaryFromRecipe({
        id: 'r1',
        name: 'Tortilla',
        durationMinutes: 40,
        ingredients: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
      })
    ).toEqual({
      recipeId: 'r1',
      name: 'Tortilla',
      mainIngredients: ['A', 'B', 'C'],
      durationMinutes: 40,
    });
  });
});
