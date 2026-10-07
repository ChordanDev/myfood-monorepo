import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, SegmentedSwitcher } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
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
  ShoppingManualCard,
  ShoppingRestoreLine,
} from '../components';
import { formatCountersLabel } from '../domain';
import { useShoppingList } from '../hooks/useShoppingList';
import type { ShoppingGroupingMode } from '../types';

const GROUPING_OPTIONS: { value: ShoppingGroupingMode; label: string }[] = [
  { value: 'category', label: 'Por categoría' },
  { value: 'supermarket', label: 'Por súper' },
];

const HORIZONTAL_PADDING = 14;
const LIST_GAP = 14;

export function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    untilDate,
    untilLabel,
    untilCalendar,
    setUntilDate,
    groupingMode,
    setGroupingMode,
    groups,
    bestOffers,
    counters,
    manualItems,
    cartItems,
    cartCount,
    toggleItem,
    toggleGroup,
    takeOutOfCart,
    confirmPurchase,
    addManualItem,
    removeItem,
    restoreRemoved,
  } = useShoppingList();
  const [isAddSheetVisible, setIsAddSheetVisible] = useState(false);
  const [isCartSheetVisible, setIsCartSheetVisible] = useState(false);
  const isListEmpty = groups.length === 0 && manualItems.length === 0;
  // The tab bar floats over the screen, so the content clears it by hand.
  const tabBarHeight = insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT;
  // The cart button floats over the list, one gap above the tab bar.
  const cartButtonBottom = tabBarHeight + LIST_GAP;
  // The list ends one gap above the button, so the last checkbox scrolls clear of it.
  const listBottomPadding = cartButtonBottom + SHOPPING_CART_BUTTON_SIZE + LIST_GAP;

  const groundStyle = useAnimatedThemeStyle({ backgroundColor: theme.appBg });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const mutedStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <Animated.View style={[styles.screen, groundStyle]}>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false}>
        <View style={styles.header}>
          {/* An empty plan has no last date to show. */}
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
            value={groupingMode}
            onChange={setGroupingMode}
            style={styles.switcher}
          />
        </View>

        <View style={styles.titleRow}>
          <Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>
            COMPRAS
          </Animated.Text>
          <Animated.Text style={[styles.counter, mutedStyle]}>
            {formatCountersLabel(counters)}
          </Animated.Text>
        </View>

        <ScrollView
          style={styles.screen}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}
          // The bottom clearance already includes the safe area. Letting iOS add it again
          // would leave that much empty space under the last card.
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}>
          {isListEmpty ? (
            <Animated.Text style={[styles.emptyLabel, mutedStyle]}>
              No hay nada para comprar
            </Animated.Text>
          ) : null}
          {groups.map((group) => (
            <ShoppingGroupCard
              key={group.key}
              group={group}
              bestOffers={bestOffers}
              onToggleItem={toggleItem}
              onRemoveItem={removeItem}
              onToggleAll={toggleGroup}
            />
          ))}
          {/* Always last and always there: it is where a manual item is added from. */}
          <ShoppingManualCard
            items={manualItems}
            onToggleItem={toggleItem}
            onRemoveItem={removeItem}
            onAdd={() => setIsAddSheetVisible(true)}
          />
          {counters.removed > 0 ? (
            <ShoppingRestoreLine removedCount={counters.removed} onRestore={restoreRemoved} />
          ) : null}
        </ScrollView>
      </SafeAreaContent>
      {/* Always on screen, even with an empty cart. Only the button takes touches. */}
      <View
        testID="shopping-cart-button"
        pointerEvents="box-none"
        style={[styles.cartButton, { bottom: cartButtonBottom }]}>
        <ShoppingCartButton count={cartCount} onPress={() => setIsCartSheetVisible(true)} />
      </View>
      <ShoppingAddItemSheet
        visible={isAddSheetVisible}
        onAdd={addManualItem}
        onClose={() => setIsAddSheetVisible(false)}
      />
      <ShoppingCartSheet
        visible={isCartSheetVisible}
        items={cartItems}
        bestOffers={bestOffers}
        onTakeOut={takeOutOfCart}
        onConfirm={confirmPurchase}
        onClose={() => setIsCartSheetVisible(false)}
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
  titleRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingHorizontal: HORIZONTAL_PADDING,
  },
});
