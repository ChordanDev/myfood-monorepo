import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { FavoriteSummary } from '@/features/favorites';

interface PlanningFavoritesPickerProps {
  favorites: FavoriteSummary[];
  selectedRecipeIds: string[];
  onToggle: (recipeId: string) => void;
}

/**
 * The step before the start button: the User's Favorite recipes as checkboxes to preselect for
 * the plan. Nothing is drawn when they have none.
 */
export function PlanningFavoritesPicker({
  favorites,
  selectedRecipeIds,
  onToggle,
}: PlanningFavoritesPickerProps) {
  const { theme } = useRecipeTheme();

  if (favorites.length === 0) return null;

  return (
    <View testID="planner-favorites" style={styles.picker}>
      <Text style={[styles.title, { color: theme.textDark }]}>Incluí tus favoritas</Text>
      <View style={styles.choices}>
        {favorites.map((favorite) => {
          const selected = selectedRecipeIds.includes(favorite.recipeId);
          return (
            <Pressable
              key={favorite.recipeId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => onToggle(favorite.recipeId)}
              testID={`planner-favorite-${favorite.recipeId}`}
              style={[
                styles.choice,
                { backgroundColor: selected ? theme.colorBlack : theme.colorLight },
              ]}>
              <Text
                style={[
                  styles.choiceLabel,
                  { color: selected ? theme.primaryAccent : theme.textDark },
                ]}>
                {favorite.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignItems: 'center',
    borderRadius: 22,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  choiceLabel: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  picker: {
    gap: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 3.5,
  },
});
