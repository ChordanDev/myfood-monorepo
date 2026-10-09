import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { FavoriteRow } from '../components/FavoriteRow';
import { useFavoritesScreen } from '../hooks/useFavoritesScreen';

const SIDE_PADDING = 14;

/** The recipes the User favorited, read from the server; each opens its recipe. */
export function FavoritesScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    favorites,
    isLoading,
    isEmpty,
    hasFailed,
    retry,
    handleBack,
    handleOpenRecipe,
    handleUnfavorite,
  } = useFavoritesScreen();
  const mutedColor = withOpacity(theme.textDark, 0.6);

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          testID="favorites-back"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          hitSlop={8}
          onPress={handleBack}>
          <ArrowLeft size={24} color={theme.primaryAccent} strokeWidth={2.5} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.textDark }]}>
          FAVORITOS
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}>
        {hasFailed ? (
          <View style={styles.notice}>
            <Text
              testID="favorites-error"
              accessibilityRole="alert"
              style={{ color: theme.textDark }}>
              No pudimos cargar tus favoritos
            </Text>
            <Pressable
              testID="favorites-retry"
              accessibilityRole="button"
              onPress={retry}
              style={[styles.retry, { backgroundColor: theme.colorDark }]}>
              <Text style={[styles.retryLabel, { color: theme.textLight }]}>Reintentar</Text>
            </Pressable>
          </View>
        ) : null}
        {isLoading ? (
          <ActivityIndicator
            testID="favorites-loading"
            accessibilityLabel="Cargando tus favoritos"
            color={theme.textDark}
          />
        ) : null}
        {isEmpty ? (
          <Text testID="favorites-empty" style={[styles.empty, { color: mutedColor }]}>
            Todavía no tenés recetas favoritas
          </Text>
        ) : null}
        {favorites.map((favorite) => (
          <FavoriteRow
            key={favorite.recipeId}
            favorite={favorite}
            onOpen={handleOpenRecipe}
            onUnfavorite={handleUnfavorite}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: SIDE_PADDING,
    paddingVertical: 12,
  },
  list: { gap: 12, paddingHorizontal: SIDE_PADDING, paddingTop: 8 },
  notice: { alignItems: 'center', gap: 12 },
  retry: { borderRadius: 20, justifyContent: 'center', minHeight: 40, paddingHorizontal: 16 },
  retryLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18 },
  screen: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
});
