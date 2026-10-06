import type { MealPlanEntry } from '@/types/domain';
import { canMarkAsCooked, isRecipeChatEnabled, resolveRecipeEntry } from './recipeEntry';

const YESTERDAY_KEY = '2026-08-24';
const TODAY_KEY = '2026-08-25';
const TOMORROW_KEY = '2026-08-26';

function buildEntry(overrides: Partial<MealPlanEntry> & Pick<MealPlanEntry, 'id'>): MealPlanEntry {
  return { date: TODAY_KEY, type: 'almuerzo', recipeId: 'r1', isCooked: false, ...overrides };
}

describe('resolveRecipeEntry', () => {
  const entries: MealPlanEntry[] = [
    buildEntry({ id: 'past-r1', date: YESTERDAY_KEY }),
    buildEntry({ id: 'today-r2', recipeId: 'r2', type: 'cena' }),
    buildEntry({ id: 'today-r1' }),
    buildEntry({ id: 'future-r1', date: TOMORROW_KEY }),
  ];

  it('returns the entry the screen was opened for', () => {
    const entry = resolveRecipeEntry({
      entries,
      recipeId: 'r1',
      entryId: 'future-r1',
      todayKey: TODAY_KEY,
    });

    expect(entry?.id).toBe('future-r1');
  });

  it('ignores an entry id that belongs to another recipe and falls back to today', () => {
    const entry = resolveRecipeEntry({
      entries,
      recipeId: 'r1',
      entryId: 'today-r2',
      todayKey: TODAY_KEY,
    });

    expect(entry?.id).toBe('today-r1');
  });

  it("falls back to today's entry for the recipe when the entry id does not exist", () => {
    const entry = resolveRecipeEntry({
      entries,
      recipeId: 'r1',
      entryId: 'gone',
      todayKey: TODAY_KEY,
    });

    expect(entry?.id).toBe('today-r1');
  });

  it("returns today's entry for the recipe when no entry id is given", () => {
    expect(resolveRecipeEntry({ entries, recipeId: 'r1', todayKey: TODAY_KEY })?.id).toBe(
      'today-r1'
    );
    expect(
      resolveRecipeEntry({ entries, recipeId: 'r1', entryId: null, todayKey: TODAY_KEY })?.id
    ).toBe('today-r1');
  });

  it('falls back to the first entry for the recipe when it is not planned today', () => {
    const entry = resolveRecipeEntry({ entries, recipeId: 'r1', todayKey: '2026-09-10' });

    expect(entry?.id).toBe('past-r1');
  });

  it('returns nothing when the recipe is not planned at all', () => {
    expect(resolveRecipeEntry({ entries, recipeId: 'r9', todayKey: TODAY_KEY })).toBeNull();
    expect(
      resolveRecipeEntry({ entries, recipeId: 'r9', entryId: 'today-r1', todayKey: TODAY_KEY })
    ).toBeNull();
    expect(resolveRecipeEntry({ entries: [], recipeId: 'r1', todayKey: TODAY_KEY })).toBeNull();
  });
});

describe('isRecipeChatEnabled', () => {
  it('enables the chat for an entry planned today', () => {
    expect(isRecipeChatEnabled(buildEntry({ id: 'today' }), TODAY_KEY)).toBe(true);
  });

  it('keeps the chat enabled for a meal of today that was already cooked', () => {
    expect(isRecipeChatEnabled(buildEntry({ id: 'today', isCooked: true }), TODAY_KEY)).toBe(true);
  });

  it('disables the chat for a past day', () => {
    expect(isRecipeChatEnabled(buildEntry({ id: 'past', date: YESTERDAY_KEY }), TODAY_KEY)).toBe(
      false
    );
  });

  it('disables the chat for a future day', () => {
    expect(isRecipeChatEnabled(buildEntry({ id: 'future', date: TOMORROW_KEY }), TODAY_KEY)).toBe(
      false
    );
  });

  it('disables the chat without an entry', () => {
    expect(isRecipeChatEnabled(null, TODAY_KEY)).toBe(false);
  });
});

describe('canMarkAsCooked', () => {
  it('allows an entry that was not cooked yet', () => {
    expect(canMarkAsCooked(buildEntry({ id: 'pending' }))).toBe(true);
  });

  it('rejects an entry that was already cooked', () => {
    expect(canMarkAsCooked(buildEntry({ id: 'cooked', isCooked: true }))).toBe(false);
  });

  it('rejects a missing entry', () => {
    expect(canMarkAsCooked(null)).toBe(false);
  });
});
