import type { CalendarProps } from '@/features/home';
import type { ShoppingLineStatus, ShoppingListLine } from './shoppingApi';

// `in_cart` is a row marked and not bought yet.
export type ShoppingItemStatus = ShoppingLineStatus;

// A row of the list: a planned line or an item added by hand, both as the API serves them.
export type ShoppingListItem = ShoppingListLine;

// Where the list is in its last read: `idle` until one is asked for, `ready` once one landed.
export type ShoppingListLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

// What the calendar of the date pill needs to offer the days the list can reach.
export type ShoppingUntilCalendar = Required<
  Pick<CalendarProps, 'markedDates' | 'isDateSelectable' | 'monthBounds'>
> & {
  // First day the list buys for. The calendar draws the stretch from it to the day the list
  // reaches; it is fixed, not something the user picks.
  rangeStart: string;
};

// A card of the list: the planned lines of one ingredient category.
export type ShoppingGroup = {
  key: string;
  title: string;
  items: ShoppingListLine[];
};

// `total` and `inCart` count the listed rows; the removed ones are counted apart.
export type ShoppingCounters = {
  total: number;
  inCart: number;
  removed: number;
};
