import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { useTitleMetrics } from '@/hooks/useTitleMetrics';
import { withOpacity } from '@/utils/colors';
import { InventoryCategoryGroup, InventoryEditSheet, InventoryVoiceButton } from '../components';
import {
  INVENTORY_HORIZONTAL_PADDING,
  INVENTORY_TITLE_FONT_SIZE,
  INVENTORY_VOICE_BUTTON_GAP,
  INVENTORY_VOICE_BUTTON_SIZE,
} from '../constants/layout';
import { groupInventoryByCategory } from '../domain';
import { useInventoryStore } from '../store';
import type { InventoryItem, InventoryItemPatch } from '../types';

// The subtitle sits right under the title, so the usual gap below the title moves under it.
const TITLE_BOTTOM_SPACING = 4;

export function InventoryScreen() {
  const { theme } = useRecipeTheme();
  const metrics = useTitleMetrics();
  const insets = useSafeAreaInsets();
  const items = useInventoryStore((state) => state.items);
  const updateItem = useInventoryStore((state) => state.updateItem);
  const removeItem = useInventoryStore((state) => state.removeItem);
  // The item is kept after closing so the fields do not empty while the sheet fades out.
  const [editSheet, setEditSheet] = useState<{ visible: boolean; item: InventoryItem | null }>({
    visible: false,
    item: null,
  });

  const groups = useMemo(() => groupInventoryByCategory(items), [items]);
  const backgroundColors: [string, string] = [theme.colorDark, theme.appBg];
  const {
    currentColors: currentBackgroundColors,
    previousColors: previousBackgroundColors,
    animatedStyle: animatedBackgroundStyle,
    AnimatedView,
  } = useGradientCrossfade(backgroundColors);

  // The list ends above the voice button, which floats over the custom tab bar.
  const listBottomPadding =
    insets.bottom +
    CUSTOM_TAB_BAR_CONTENT_HEIGHT +
    INVENTORY_VOICE_BUTTON_GAP +
    INVENTORY_VOICE_BUTTON_SIZE +
    INVENTORY_VOICE_BUTTON_GAP;

  const handleCloseEditSheet = () => {
    setEditSheet((current) => ({ ...current, visible: false }));
  };

  const handleSaveEdit = (patch: InventoryItemPatch) => {
    if (editSheet.item) {
      updateItem(editSheet.item.id, patch);
    }

    handleCloseEditSheet();
  };

  return (
    <View style={[styles.screen, { backgroundColor: backgroundColors[1] }]}>
      <LinearGradient
        colors={previousBackgroundColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        locations={[0, 0.1]}
        style={StyleSheet.absoluteFill}
      />
      <AnimatedView style={[StyleSheet.absoluteFill, animatedBackgroundStyle]}>
        <LinearGradient
          colors={currentBackgroundColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          locations={[0, 0.1]}
          style={styles.gradient}
        />
      </AnimatedView>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent includeBottom={false} style={styles.content}>
        <TitlePrimary
          text="INVENTARIO"
          metrics={{
            ...metrics,
            titleFontSize: INVENTORY_TITLE_FONT_SIZE,
            titleBottomSpacing: TITLE_BOTTOM_SPACING,
          }}
        />
        <Text style={[styles.subtitle, { color: withOpacity(theme.textDark, 0.6) }]}>
          Cantidades aproximadas. Decile al micrófono qué usaste.
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}>
          {groups.length > 0 ? (
            groups.map((group) => (
              <InventoryCategoryGroup
                key={group.category}
                category={group.category}
                items={group.items}
                onEditItem={(item) => setEditSheet({ visible: true, item })}
                onDeleteItem={(item) => removeItem(item.id)}
              />
            ))
          ) : (
            <Text style={[styles.emptyState, { color: withOpacity(theme.textDark, 0.6) }]}>
              Todavía no hay nada en tu inventario.
            </Text>
          )}
        </ScrollView>
      </SafeAreaContent>
      <InventoryVoiceButton />
      <InventoryEditSheet
        visible={editSheet.visible}
        item={editSheet.item}
        onSave={handleSaveEdit}
        onClose={handleCloseEditSheet}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  emptyState: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 24,
    textAlign: 'center',
  },
  gradient: { flex: 1 },
  list: {
    gap: 10,
    paddingHorizontal: INVENTORY_HORIZONTAL_PADDING,
  },
  screen: { flex: 1 },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 18,
    paddingHorizontal: INVENTORY_HORIZONTAL_PADDING,
    textAlign: 'center',
  },
});
