import { StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, Check, Star } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RECIPE_HEADER_HEIGHT, RECIPE_SCREEN_SIDE_PADDING } from '../constants';
import { RecipeHeaderButton, recipeHeaderShadow } from './RecipeHeaderButton';

interface RecipeHeaderProps {
  /** Distance from the top of the screen; the screen owns the safe-area math. */
  top: number;
  title: string;
  isFavorite: boolean;
  canMarkAsCooked: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onMarkAsCooked: () => void;
}

const ICON_STROKE_WIDTH = 2.5;

/** Stays fixed over the scrolling content, so every action is reachable at any scroll position. */
export function RecipeHeader({
  top,
  title,
  isFavorite,
  canMarkAsCooked,
  onBack,
  onToggleFavorite,
  onMarkAsCooked,
}: RecipeHeaderProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={[styles.header, { top }]}>
      <RecipeHeaderButton testID="recipe-header-back" accessibilityLabel="Volver" onPress={onBack}>
        <ArrowLeft size={24} color={theme.primaryAccent} strokeWidth={ICON_STROKE_WIDTH} />
      </RecipeHeaderButton>

      <View style={[styles.titlePill, { backgroundColor: theme.colorBlack }]}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.title, { color: theme.primaryAccent }]}>
          {title}
        </Text>
      </View>

      <RecipeHeaderButton
        testID="recipe-header-favorite"
        accessibilityLabel={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
        selected={isFavorite}
        onPress={onToggleFavorite}>
        <Star
          size={22}
          color={theme.primaryAccent}
          fill={isFavorite ? theme.primaryAccent : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
        />
      </RecipeHeaderButton>

      <RecipeHeaderButton
        testID="recipe-header-cooked"
        accessibilityLabel="Marcar como cocinada"
        disabled={!canMarkAsCooked}
        onPress={onMarkAsCooked}>
        <Check size={24} color={theme.primaryAccent} strokeWidth={ICON_STROKE_WIDTH} />
      </RecipeHeaderButton>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    left: RECIPE_SCREEN_SIDE_PADDING,
    position: 'absolute',
    right: RECIPE_SCREEN_SIDE_PADDING,
    zIndex: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.35,
    lineHeight: 21,
    textAlign: 'center',
  },
  titlePill: {
    ...recipeHeaderShadow,
    borderRadius: 9999,
    flex: 1,
    height: RECIPE_HEADER_HEIGHT,
    justifyContent: 'center',
    // Lets the pill shrink below the width of a long name instead of pushing the buttons out.
    minWidth: 0,
    paddingHorizontal: 17.5,
  },
});
