import type { ShoppingCounters, ShoppingListTotals, ShoppingUntilCalendar } from '../types';

// The planned dates of a read are the days the list can reach: every day from the Account's
// today on with a meal to buy for, sorted. "Today" is the server's, so nothing here compares
// a date with the clock of this device.

// The last planned date: where the list reaches while no day is chosen.
export function getDefaultUntilDate(plannedDates: string[]): string | undefined {
  return plannedDates[plannedDates.length - 1];
}

// The date the list reaches: the chosen day while it is one of the planned dates, otherwise
// the last of them.
export function resolveUntilDate(
  plannedDates: string[],
  chosenUntilDate: string | undefined
): string | undefined {
  const isChosenDatePlanned =
    chosenUntilDate !== undefined && plannedDates.includes(chosenUntilDate);

  return isChosenDatePlanned ? chosenUntilDate : getDefaultUntilDate(plannedDates);
}

// The calendar that picks the date: exactly the planned dates can be picked, they carry the
// mark of a planned day, and only their months can be walked. It draws the stretch the list
// buys for from the first of them. Without a planned date there is no calendar: there is no
// day to pick.
export function getUntilCalendar(plannedDates: string[]): ShoppingUntilCalendar | undefined {
  const [rangeStart] = plannedDates;
  if (rangeStart === undefined) return undefined;

  return {
    markedDates: plannedDates,
    isDateSelectable: (dateKey) => plannedDates.includes(dateKey),
    monthBounds: { months: [...new Set(plannedDates.map((date) => date.slice(0, 7)))] },
    rangeStart,
  };
}

// The counter of the title, as the server counted the lines of the read.
export function getShoppingCounters({
  needed,
  inCart,
  removed,
}: ShoppingListTotals): ShoppingCounters {
  return { total: needed + inCart, inCart, removed };
}
