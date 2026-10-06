import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, SegmentedSwitcher } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { ShoppingDatePill, ShoppingGroupCard } from '../components';
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
    untilLabel,
    groupingMode,
    setGroupingMode,
    groups,
    bestOffers,
    counters,
    toggleItem,
    toggleGroup,
  } = useShoppingList();
  // The tab bar floats over the screen, so the content clears it by hand.
  const tabBarHeight = insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT;

  const groundStyle = useAnimatedThemeStyle({ backgroundColor: theme.appBg });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const mutedStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <Animated.View style={[styles.screen, groundStyle]}>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false}>
        <View style={styles.header}>
          {/* An empty plan has no last date to show. */}
          {untilLabel ? <ShoppingDatePill label={untilLabel} /> : null}
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

        {groups.length > 0 ? (
          <ScrollView
            style={styles.screen}
            contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + LIST_GAP }]}
            // The bottom clearance already includes the safe area. Letting iOS add it again
            // would leave that much empty space under the last card.
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}>
            {groups.map((group) => (
              <ShoppingGroupCard
                key={group.key}
                group={group}
                bestOffers={bestOffers}
                onToggleItem={toggleItem}
                onToggleAll={toggleGroup}
              />
            ))}
          </ScrollView>
        ) : (
          <View style={[styles.emptyState, { paddingBottom: tabBarHeight }]}>
            <Animated.Text style={[styles.emptyLabel, mutedStyle]}>
              No hay nada para comprar
            </Animated.Text>
          </View>
        )}
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
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: HORIZONTAL_PADDING,
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
