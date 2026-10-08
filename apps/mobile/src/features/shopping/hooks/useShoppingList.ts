import { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import { getAuthErrorMessage } from '@/api/errors';
import { useAuth } from '@/features/auth';
import {
  formatItemMealsLine,
  formatUntilLabel,
  getDefaultUntilDate,
  getShoppingCounters,
  getUntilCalendar,
  groupItemsByCategory,
  resolveUntilDate,
} from '../domain';
import { useShoppingListStore } from '../store';
import type { ShoppingGroupBy, ShoppingListLine } from '../types';

// Second line of every row that has one, keyed by line id.
function getMetaLines(lines: ShoppingListLine[], groupBy: ShoppingGroupBy) {
  const metaLines: Record<string, string> = {};

  for (const line of lines) {
    const metaLine = formatItemMealsLine(line, groupBy);
    if (metaLine !== undefined) metaLines[line.id] = metaLine;
  }

  return metaLines;
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

  // The cache outlives a sign-out, and the read below only drops it once it runs. So what was
  // read for another user is left out here, while rendering: it is never drawn, not even on
  // the render before that read starts.
  const isOwnCache = ownerId !== null && cacheOwnerId === ownerId;
  const list = isOwnCache ? cachedList : null;
  const status = isOwnCache ? cachedStatus : 'idle';
  const error = isOwnCache ? cachedError : null;

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

  // Picking the last planned day asks for the whole plan, so nothing is kept as chosen: the
  // list keeps reaching the last planned date as the plan grows.
  const setUntilDate = useCallback(
    (dateKey: string) => {
      const lastPlannedDate = getDefaultUntilDate(list?.plannedDates ?? []);

      setChosenUntilDate(dateKey === lastPlannedDate ? undefined : dateKey);
    },
    [list, setChosenUntilDate]
  );

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
    // A read landed and it has no line to buy.
    isEmpty: list !== null && groups.length === 0,
    // Set while the last read failed. The list of the read before it, if any, stays.
    errorMessage: status === 'error' ? getAuthErrorMessage(error) : undefined,
    retry,
  };
}
