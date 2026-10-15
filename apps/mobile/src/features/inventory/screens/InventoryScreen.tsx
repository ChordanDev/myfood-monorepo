import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthErrorMessage } from '@/api/errors';
import { NoisyBackground, SafeAreaContent, TitlePrimary } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import { useGradientCrossfade } from '@/hooks/useGradientCrossfade';
import { useTitleMetrics } from '@/hooks/useTitleMetrics';
import { withOpacity } from '@/utils/colors';
import {
  InventoryAddSheet,
  InventoryEditSheet,
  InventorySection,
  InventoryVoiceButton,
  InventoryVoiceSheet,
} from '../components';
import { previewVoice } from '../api';
import { INVENTORY_FRESHNESS_LABELS } from '../constants/freshness';
import {
  INVENTORY_HORIZONTAL_PADDING,
  INVENTORY_TITLE_FONT_SIZE,
  INVENTORY_VOICE_BUTTON_GAP,
  INVENTORY_VOICE_BUTTON_SIZE,
} from '../constants/layout';
import { groupInventoryByFreshness } from '../domain';
import { useInventoryStore } from '../store';
import type { InventoryItem } from '../types';

// The subtitle sits right under the title, so the usual gap below the title moves under it.
const TITLE_BOTTOM_SPACING = 4;
const ADD_ICON_SIZE = 18;

export function InventoryScreen() {
  const { theme } = useRecipeTheme();
  const router = useRouter();
  const metrics = useTitleMetrics();
  const insets = useSafeAreaInsets();
  const items = useInventoryStore((state) => state.items);
  const loadStatus = useInventoryStore((state) => state.loadStatus);
  const loadError = useInventoryStore((state) => state.loadError);
  const refresh = useInventoryStore((state) => state.refresh);
  const addExtra = useInventoryStore((state) => state.addExtra);
  const setQuantity = useInventoryStore((state) => state.setQuantity);
  const dispose = useInventoryStore((state) => state.dispose);
  const applyVoice = useInventoryStore((state) => state.applyVoice);
  const [isAddSheetVisible, setIsAddSheetVisible] = useState(false);
  const [isVoiceSheetVisible, setIsVoiceSheetVisible] = useState(false);
  // The item is kept after closing so the fields do not empty while the sheet fades out.
  const [editSheet, setEditSheet] = useState<{ visible: boolean; item: InventoryItem | null }>({
    visible: false,
    item: null,
  });

  // The inventory is the one the API has: it is read again every time the tab is shown, and
  // what the store holds from the last read is drawn meanwhile.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const sections = useMemo(() => groupInventoryByFreshness(items), [items]);
  const hasItems = sections.length > 0;
  // Before the first read is answered there is nothing to say about the inventory yet.
  const isLoading = !hasItems && (loadStatus === 'idle' || loadStatus === 'loading');
  const isEmpty = !hasItems && loadStatus === 'ready';
  const mutedTextColor = withOpacity(theme.textDark, 0.6);
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
        <Text style={[styles.subtitle, { color: mutedTextColor }]}>
          Cantidades aproximadas. Decile al micrófono qué usaste.
        </Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: listBottomPadding }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsAddSheetVisible(true)}
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: withOpacity(theme.textDark, 0.3), opacity: pressed ? 0.7 : 1 },
            ]}>
            <Plus size={ADD_ICON_SIZE} color={theme.textDark} strokeWidth={2.5} />
            <Text style={[styles.addLabel, { color: theme.textDark }]}>Agregar producto</Text>
          </Pressable>

          {/* Prepared leftovers are not Inventory, so they live on their own screen. */}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Ver sobras"
            onPress={() => router.push('/leftovers')}
            style={({ pressed }) => [
              styles.leftoversLink,
              { backgroundColor: theme.colorLight, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text style={[styles.addLabel, { color: theme.textDark }]}>Sobras</Text>
            <ChevronRight size={ADD_ICON_SIZE} color={theme.textDark} strokeWidth={2.5} />
          </Pressable>

          {/* A failed read leaves the last one on screen, under its error. */}
          {loadStatus === 'error' ? (
            <View style={[styles.loadError, { backgroundColor: theme.colorLight }]}>
              <Text accessibilityRole="alert" style={[styles.message, { color: theme.textDark }]}>
                {getAuthErrorMessage(loadError)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={refresh}
                style={({ pressed }) => [
                  styles.retryButton,
                  { backgroundColor: theme.colorDark, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.retryLabel, { color: theme.textLight }]}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}

          {sections.map((section) => (
            <InventorySection
              key={section.freshness}
              title={INVENTORY_FRESHNESS_LABELS[section.freshness]}
              items={section.items}
              onEditItem={(item) => setEditSheet({ visible: true, item })}
            />
          ))}

          {isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={theme.textDark} />
              <Text style={[styles.message, { color: mutedTextColor }]}>
                Cargando tu inventario…
              </Text>
            </View>
          ) : null}

          {isEmpty ? (
            <Text style={[styles.message, styles.emptyState, { color: mutedTextColor }]}>
              Todavía no hay nada en tu inventario.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaContent>
      <InventoryVoiceButton onPress={() => setIsVoiceSheetVisible(true)} />
      <InventoryAddSheet
        visible={isAddSheetVisible}
        onAdd={addExtra}
        onClose={() => setIsAddSheetVisible(false)}
      />
      <InventoryEditSheet
        visible={editSheet.visible}
        item={editSheet.item}
        onSetQuantity={setQuantity}
        onDispose={dispose}
        onClose={handleCloseEditSheet}
      />
      <InventoryVoiceSheet
        visible={isVoiceSheetVisible}
        onPreview={previewVoice}
        onApply={applyVoice}
        onClose={() => setIsVoiceSheetVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
  },
  addLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  content: { flex: 1 },
  emptyState: {
    marginTop: 14,
    textAlign: 'center',
  },
  gradient: { flex: 1 },
  leftoversLink: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  list: {
    gap: 10,
    paddingHorizontal: INVENTORY_HORIZONTAL_PADDING,
  },
  loadError: {
    borderRadius: 21,
    gap: 12,
    padding: 16,
  },
  loading: {
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  message: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
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
