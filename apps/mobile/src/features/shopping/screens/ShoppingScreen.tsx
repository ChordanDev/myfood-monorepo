import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { X } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, SegmentedSwitcher } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { ShoppingDatePill, ShoppingGroupCard, ShoppingLoadError } from '../components';
import { formatCountersLabel } from '../domain';
import { useCartLease } from '../hooks/useCartLease';
import { useShoppingList } from '../hooks/useShoppingList';
import type { ShoppingGroupBy } from '../types';

const GROUPING_OPTIONS: { value: ShoppingGroupBy; label: string }[] = [
  { value: 'ingredient', label: 'Por ingrediente' },
  { value: 'meal', label: 'Por comida' },
];

const HORIZONTAL_PADDING = 14;
const LIST_GAP = 14;

// The list as the server has it. A row can be ticked into the Cart, which holds a lease the
// screen keeps alive while it is open; the Cart can be abandoned. Un-ticking a row, removing
// it, adding one by hand and buying the cart are not on this screen until the server takes
// them.
export function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    untilDate,
    untilLabel,
    untilCalendar,
    setUntilDate,
    groupBy,
    setGroupBy,
    groups,
    metaLines,
    counters,
    isLoading,
    isReadingAgain,
    isEmpty,
    errorMessage,
    retry,
    cart: listCart,
    lines,
  } = useShoppingList();
  const {
    cart,
    markItems,
    cancel,
    errorMessage: cartErrorMessage,
  } = useCartLease({
    listCart,
    refreshList: retry,
  });

  // A row stands for one line: ticking it ticks the items behind it. A line already in the
  // Cart has nothing to tick.
  const tickLine = useCallback(
    (lineId: string) => {
      const line = lines.find((candidate) => candidate.id === lineId);

      if (line && line.status === 'needed') {
        markItems(line.allocations.map((allocation) => allocation.itemId));
      }
    },
    [lines, markItems]
  );
  // The tab bar floats over the screen, so the content clears it by hand.
  const tabBarHeight = insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT;
  // The list ends one gap above the tab bar, so the last card scrolls clear of it.
  const listBottomPadding = tabBarHeight + LIST_GAP;

  const groundStyle = useAnimatedThemeStyle({ backgroundColor: theme.appBg });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const mutedStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <Animated.View style={[styles.screen, groundStyle]}>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false}>
        <View style={styles.header}>
          {/* Without a planned date, or before the first read, there is no last date to show. */}
          {untilDate && untilLabel ? (
            <ShoppingDatePill
              label={untilLabel}
              untilDate={untilDate}
              calendar={untilCalendar}
              onSelectDate={setUntilDate}
            />
          ) : null}
          <SegmentedSwitcher
            options={GROUPING_OPTIONS}
            value={groupBy}
            onChange={setGroupBy}
            style={styles.switcher}
          />
        </View>

        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>
              COMPRAS
            </Animated.Text>
            {/* The list under it stays, and stays usable: this only says it is being read again. */}
            {isReadingAgain ? (
              <ActivityIndicator
                accessibilityLabel="Actualizando la lista de compras"
                color={theme.textDark}
                size="small"
              />
            ) : null}
          </View>
          {counters ? (
            <Animated.Text style={[styles.counter, mutedStyle]}>
              {formatCountersLabel(counters)}
            </Animated.Text>
          ) : null}
          {cart ? (
            <Pressable
              onPress={cancel}
              accessibilityRole="button"
              accessibilityLabel="Cancelar carrito"
              hitSlop={10}>
              <X color={theme.textDark} size={18} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          style={styles.screen}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
          // The bottom clearance already includes the safe area. Letting iOS add it again
          // would leave that much empty space under the last card.
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}>
          {/* Above the cards: a list that could not be read again is still the last one read. */}
          {errorMessage ? <ShoppingLoadError message={errorMessage} onRetry={retry} /> : null}
          {cartErrorMessage ? (
            <Animated.Text accessibilityRole="alert" style={[styles.emptyLabel, mutedStyle]}>
              {cartErrorMessage}
            </Animated.Text>
          ) : null}
          {isLoading ? (
            <ActivityIndicator
              accessibilityLabel="Cargando la lista de compras"
              color={theme.textDark}
              style={styles.loading}
            />
          ) : null}
          {isEmpty ? (
            <Animated.Text style={[styles.emptyLabel, mutedStyle]}>
              No hay nada para comprar
            </Animated.Text>
          ) : null}
          {/* Only the tick is offered: a card without the other handlers has no removal and no
              "Marcar todos". */}
          {groups.map((group) => (
            <ShoppingGroupCard
              key={group.key}
              group={group}
              metaLines={metaLines}
              onToggleItem={tickLine}
            />
          ))}
        </ScrollView>
      </SafeAreaContent>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  counter: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  emptyLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 24,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
  list: {
    gap: LIST_GAP,
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 14,
  },
  loading: {
    paddingVertical: 24,
  },
  screen: {
    flex: 1,
  },
  switcher: {
    flex: 1,
  },
  title: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 28,
    lineHeight: 34,
  },
  // The title comes first, so the row keeps aligning the counter to its baseline whether the
  // indicator is there or not.
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  titleRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
});
