import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { X } from 'lucide-react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, SegmentedSwitcher } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useInventoryStore } from '@/features/inventory';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import {
  SHOPPING_CART_BUTTON_SIZE,
  ShoppingAddItemSheet,
  ShoppingCartButton,
  ShoppingCartSheet,
  ShoppingDatePill,
  ShoppingGroupCard,
  ShoppingLoadError,
  ShoppingManualCard,
  ShoppingRestoreLine,
} from '../components';
import { formatCountersLabel, getItemIdsToBuy } from '../domain';
import { useCartLease } from '../hooks/useCartLease';
import { useShoppingList } from '../hooks/useShoppingList';
import type { CheckoutLine, ShoppingGroupBy } from '../types';

const GROUPING_OPTIONS: { value: ShoppingGroupBy; label: string }[] = [
  { value: 'ingredient', label: 'Por ingrediente' },
  { value: 'meal', label: 'Por comida' },
];

const HORIZONTAL_PADDING = 14;
const LIST_GAP = 14;

// The list as the server has it. The User can add an item by hand, remove one (a planned item
// is only taken off the list, a manual one is deleted) and bring the removed ones back. A row
// can be ticked into the Cart, which holds a lease the screen keeps alive while it is open; the
// Cart can be abandoned, or opened from its button and bought in person, with the quantity
// bought of each line. What was bought enters the Inventory and stays listed as bought until
// its meal is cooked. Un-ticking a row is not on this screen until the server takes it.
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
    refresh,
    cart: listCart,
    cartLines,
    plannedLines,
    manualItems,
    removedCount,
    addManualItem,
    removeItem,
    restoreItems,
    isChanging,
    changeErrorMessage,
    dismissChangeError,
  } = useShoppingList();
  const [isAddSheetVisible, setIsAddSheetVisible] = useState(false);
  const [isCartSheetVisible, setIsCartSheetVisible] = useState(false);
  const refreshInventory = useInventoryStore((state) => state.refresh);
  const {
    cart,
    markItems,
    cancel,
    confirm,
    isConfirming,
    confirmErrorMessage,
    dismissConfirmError,
    errorMessage: cartErrorMessage,
  } = useCartLease({
    listCart,
    refreshList: refresh,
  });

  // A row stands for one planned line: ticking it ticks the items behind it that are still to
  // buy. A line already in the Cart has nothing to tick, and neither has a bought one. Only
  // the planned lines are looked up: an item added by hand has no row to tick on this screen.
  const tickLine = useCallback(
    (lineId: string) => {
      const line = plannedLines.find((candidate) => candidate.id === lineId);
      const itemIds = line && line.status === 'needed' ? getItemIdsToBuy(line) : [];

      if (itemIds.length > 0) markItems(itemIds);
    },
    [plannedLines, markItems]
  );

  // A Cart that ran out while it was open has nothing left to confirm, and the next Cart does
  // not open by itself.
  if (!cart && isCartSheetVisible) {
    setIsCartSheetVisible(false);
  }

  const closeCartSheet = useCallback(() => {
    setIsCartSheetVisible(false);
    dismissConfirmError();
  }, [dismissConfirmError]);

  // Buying the Cart moves it into the Inventory: the list is read again by the lease, and the
  // Inventory here, so its tab shows what was bought without being reloaded. A Cart that is
  // gone has nothing left to confirm, and a refused one stays open to be tried again.
  const confirmCart = useCallback(
    async (boughtLines: CheckoutLine[]) => {
      const outcome = await confirm(boughtLines);

      if (outcome === 'refused') return;
      if (outcome === 'purchased') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refreshInventory();
      }
      setIsCartSheetVisible(false);
    },
    [confirm, refreshInventory]
  );

  // The tab bar floats over the screen, so the content clears it by hand.
  const tabBarHeight = insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT;
  // The list ends one gap above the tab bar, so the last card scrolls clear of it, and of the
  // cart button while there is one.
  const listBottomPadding =
    tabBarHeight + LIST_GAP + (cart ? SHOPPING_CART_BUTTON_SIZE + LIST_GAP : 0);

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
            {isChanging ? (
              <ActivityIndicator
                accessibilityLabel="Guardando los cambios"
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
          {/* A change the server did not take: the list below is the last one read. */}
          {changeErrorMessage ? (
            <ShoppingLoadError
              message={changeErrorMessage}
              onRetry={dismissChangeError}
              actionLabel="Entendido"
            />
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
          {/* Rows are ticked into the Cart and held to remove them; a card without the other
              handlers has no "Marcar todos". */}
          {groups.map((group) => (
            <ShoppingGroupCard
              key={group.key}
              group={group}
              metaLines={metaLines}
              onToggleItem={tickLine}
              onRemoveItem={removeItem}
            />
          ))}
          {/* Once a list was read: before that, an empty card would say nothing was added. */}
          {counters ? (
            <ShoppingManualCard
              items={manualItems}
              onRemoveItem={removeItem}
              onAdd={() => setIsAddSheetVisible(true)}
            />
          ) : null}
          {removedCount > 0 ? (
            <ShoppingRestoreLine removedCount={removedCount} onRestore={restoreItems} />
          ) : null}
        </ScrollView>
      </SafeAreaContent>

      {/* Over the list, above the tab bar: what the Cart holds is one press away. It counts
          what a confirm buys: the lines the sheet lists and the items it does not, so it is
          never zero for a Cart whose items are all after the date the list reaches. */}
      {cart ? (
        <View
          testID="shopping-cart-button"
          style={[styles.cartButton, { bottom: tabBarHeight + LIST_GAP }]}>
          <ShoppingCartButton
            count={cartLines.length}
            onPress={() => setIsCartSheetVisible(true)}
          />
        </View>
      ) : null}

      <ShoppingCartSheet
        visible={isCartSheetVisible}
        lines={cartLines}
        isConfirming={isConfirming}
        errorMessage={confirmErrorMessage}
        onConfirm={confirmCart}
        onClose={closeCartSheet}
      />

      <ShoppingAddItemSheet
        visible={isAddSheetVisible}
        onAdd={addManualItem}
        onClose={() => setIsAddSheetVisible(false)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cartButton: {
    position: 'absolute',
    right: HORIZONTAL_PADDING,
  },
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
