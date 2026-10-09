import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import { formatFavoriteDuration, formatFavoriteIngredients } from '../domain/favoriteFormat';
import type { FavoriteSummary } from '../types/favorites';

interface FavoriteRowProps {
  favorite: FavoriteSummary;
  onOpen: (favorite: FavoriteSummary) => void;
  onUnfavorite: (favorite: FavoriteSummary) => void;
}

/** One favorite: its name, main ingredients and duration, with the way to unfavorite it. */
export function FavoriteRow({ favorite, onOpen, onUnfavorite }: FavoriteRowProps) {
  const { theme } = useRecipeTheme();
  const ingredients = formatFavoriteIngredients(favorite.mainIngredients);
  const duration = formatFavoriteDuration(favorite.durationMinutes);
  const mutedColor = withOpacity(theme.textDark, 0.6);

  return (
    <View style={[styles.row, { backgroundColor: theme.colorLight }]}>
      <Pressable
        testID={`favorite-open-${favorite.recipeId}`}
        accessibilityRole="button"
        accessibilityLabel={favorite.name}
        onPress={() => onOpen(favorite)}
        style={styles.body}>
        <Text style={[styles.name, { color: theme.textDark }]}>{favorite.name}</Text>
        {ingredients ? (
          <Text testID={`favorite-ingredients-${favorite.recipeId}`} style={{ color: mutedColor }}>
            {ingredients}
          </Text>
        ) : null}
        {duration ? (
          <Text testID={`favorite-duration-${favorite.recipeId}`} style={{ color: mutedColor }}>
            {duration}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        testID={`favorite-remove-${favorite.recipeId}`}
        accessibilityRole="button"
        accessibilityLabel="Quitar de favoritos"
        hitSlop={8}
        onPress={() => onUnfavorite(favorite)}
        style={styles.remove}>
        <Star size={22} color={theme.primaryAccent} fill={theme.primaryAccent} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 4 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22 },
  remove: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
  row: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
