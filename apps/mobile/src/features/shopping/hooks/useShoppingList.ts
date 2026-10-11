import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage } from '@/api/errors';
import { useAuth } from '@/features/auth';
import {
  formatItemMealsLine,
  formatUntilLabel,
  getCartLines,
  getDefaultUntilDate,
  getShoppingCounters,
  getUntilCalendar,
  groupItemsByCategory,
  resolveUntilDate,
} from '../domain';
import { useShoppingListStore } from '../store';
import type { NewManualShoppingItem, ShoppingGroupBy, ShoppingListLine } from '../types';

// Second line of every row that has one, keyed by line id.
function getMetaLines(lines: ShoppingListLine[], groupBy: ShoppingGroupBy) {
  const metaLines: Record<string, string> = {};

  for (const line of lines) {
    const metaLine = formatItemMealsLine(line, groupBy);
    if (metaLine !== undefined) metaLines[line.id] = metaLine;
  }

  return metaLines;
}

// The Shopping items a line stands for: what the server takes to remove or restore it. One
// that was bought is not on the list to be removed, and the server refuses the whole change
// for it.
function getItemIds({ allocations }: ShoppingListLine) {
  return allocations.filter(({ status }) => status !== 'purchased').map(({ itemId }) => itemId);
}

// The Shopping list as the screen shows it: the last read of the server, and how the user
// asked to read it. Nothing is derived from what the device knows about the plan.
export function useShoppingList() {
  // The signed-in user, or nobody: whose list this is.
  const ownerId = useAuth().user?.id ?? null;
  const cacheOwnerId = useShoppingListStore((state) => state.ownerId);
  const cachedList = useShoppingListStore((state) => state.list);
  const cachedStatus = useShoppingListStore((state) => state.status);
  const cachedError = useShoppingListStore((state) => state.error);
  const chosenUntilDate = useShoppingListStore((state) => state.chosenUntilDate);
  const groupBy = useShoppingListStore((state) => state.groupBy);
  const refresh = useShoppingListStore((state) => state.refresh);
  const setChosenUntilDate = useShoppingListStore((state) => state.setChosenUntilDate);
  const setGroupBy = useShoppingListStore((state) => state.setGroupBy);
  const pendingChanges = useShoppingListStore((state) => state.pendingChanges);
  const cachedChangeError = useShoppingListStore((state) => state.changeError);
  const addItem = useShoppingListStore((state) => state.addManualItem);
  const deleteItem = useShoppingListStore((state) => state.deleteItem);
  const setItemsStatus = useShoppingListStore((state) => state.setItemsStatus);
  const clearChangeError = useShoppingListStore((state) => state.clearChangeError);

  // The cache outlives a sign-out, and the read below only drops it once it runs. So what was
  // read for another user is left out here, while rendering: it is never drawn, not even on
  // the render before that read starts.
  const isOwnCache = ownerId !== null && cacheOwnerId === ownerId;
  const list = isOwnCache ? cachedList : null;
  const status = isOwnCache ? cachedStatus : 'idle';
  const error = isOwnCache ? cachedError : null;
  const changeError = isOwnCache ? cachedChangeError : null;

  // The list changes behind the screen, when a meal is planned or cooked on another tab or by
  // another member: it is read when the screen is first shown and every time it is come back
  // to. It is read again too when the user changes, and dropped when nobody is signed in.
  useFocusEffect(
    useCallback(() => {
      refresh(ownerId);
    }, [refresh, ownerId])
  );

  const untilDate = useMemo(
    () => (list ? resolveUntilDate(list.plannedDates, chosenUntilDate) : undefined),
    [list, chosenUntilDate]
  );
  const untilCalendar = useMemo(
    () => (list ? getUntilCalendar(list.plannedDates) : undefined),
    [list]
  );

  const groups = useMemo(() => groupItemsByCategory(list?.planned ?? []), [list]);
  const metaLines = useMemo(() => getMetaLines(list?.planned ?? [], groupBy), [list, groupBy]);
  const counters = useMemo(() => (list ? getShoppingCounters(list.totals) : undefined), [list]);
  const cartLines = useMemo(() => getCartLines(list), [list]);

  // Picking the last planned day asks for the whole plan, so nothing is kept as chosen: the
  // list keeps reaching the last planned date as the plan grows.
  const setUntilDate = useCallback(
    (dateKey: string) => {
      const lastPlannedDate = getDefaultUntilDate(list?.plannedDates ?? []);

      setChosenUntilDate(dateKey === lastPlannedDate ? undefined : dateKey);
    },
    [list, setChosenUntilDate]
  );

  // The lines the User added by hand, apart from the planned ones.
  const manualItems = list?.manual ?? [];
  const removedLines = useMemo(
    () => (list?.planned ?? []).filter((line) => line.status === 'removed'),
    [list]
  );

  // A manual item is deleted. A planned one is only removed, so it can be restored, with every
  // share of it: the id of a line is not the id of a Shopping item. A purchased line is neither.
  const removeItem = useCallback(
    (lineId: string) => {
      const manualLine = list?.manual.find((line) => line.id === lineId);
      if (manualLine) return deleteItem(manualLine.id);

      const plannedLine = list?.planned.find((line) => line.id === lineId);
      const itemIds = plannedLine ? getItemIds(plannedLine) : [];
      if (!plannedLine || plannedLine.status === 'removed' || itemIds.length === 0) {
        return Promise.resolve(false);
      }

      return setItemsStatus(itemIds, 'removed');
    },
    [list, deleteItem, setItemsStatus]
  );

  // Brings back every line that was removed.
  const restoreItems = useCallback(() => {
    const itemIds = removedLines.flatMap(getItemIds);

    return itemIds.length === 0 ? Promise.resolve(false) : setItemsStatus(itemIds, 'needed');
  }, [removedLines, setItemsStatus]);

  const retry = useCallback(() => {
    refresh(ownerId);
  }, [refresh, ownerId]);

  return {
    untilDate,
    untilLabel: untilDate === undefined ? undefined : formatUntilLabel(untilDate),
    untilCalendar,
    setUntilDate,
    groupBy,
    setGroupBy,
    groups,
    metaLines,
    // Not known until a read lands.
    counters,
    // The first read of the signed-in user is on its way: there is no list to show yet.
    isLoading: ownerId !== null && list === null && status !== 'error',
    // A read is on its way over the list on show: after a retry, a change of preference or a
    // return to the screen. Never together with `isLoading`, which has no list.
    isReadingAgain: list !== null && status === 'loading',
    // A read landed and it has no line to buy.
    isEmpty: list !== null && groups.length === 0,
    // Set while the last read failed. The list of the read before it, if any, stays.
    errorMessage: status === 'error' ? getAuthErrorMessage(error) : undefined,
    retry,
    // The caller's own active Cart as the last read reported it.
    cart: list?.cart ?? null,
    // What that read shows as in a Cart, as a confirm names it.
    cartLines,
    // Whole lines, to find the items behind a row.
    lines: list?.planned ?? [],
    manualItems,
    // The planned lines the User removed, as the server counted them.
    removedCount: list?.totals.removed ?? 0,
    addManualItem: (item: NewManualShoppingItem) => addItem(item),
    removeItem,
    restoreItems,
    // A change is on its way to the server.
    isChanging: isOwnCache && pendingChanges > 0,
    // Set while the last change was refused or could not be sent; the list is the last one read.
    changeErrorMessage: changeError === null ? undefined : getAuthErrorMessage(changeError),
    dismissChangeError: clearChangeError,
  };
}
