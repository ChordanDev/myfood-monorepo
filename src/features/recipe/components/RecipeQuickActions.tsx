import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { withOpacity } from '@/utils/colors';
import type { RecipeChatAction } from '../domain/recipeChat';

interface RecipeQuickActionsProps {
  /** Id of the assistant message the actions answer. */
  messageId: string;
  actions: RecipeChatAction[];
  onSelect: (messageId: string, actionId: RecipeChatAction['id']) => void;
}

// Chips are 40pt tall: 2pt on each side reaches a 44pt target.
const HIT_SLOP = { top: 2, bottom: 2 };

/** Quick replies under an assistant message: the affirmative one is filled, the other outlined. */
export function RecipeQuickActions({ messageId, actions, onSelect }: RecipeQuickActionsProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={styles.row}>
      {actions.map((action) => {
        const isPrimary = action.id === 'confirm_add';

        return (
          <Pressable
            key={action.id}
            testID={`recipe-chat-action-${messageId}-${action.id}`}
            accessibilityRole="button"
            hitSlop={HIT_SLOP}
            onPress={() => onSelect(messageId, action.id)}
            style={[
              styles.chip,
              isPrimary
                ? { backgroundColor: theme.colorDark }
                : { borderColor: withOpacity(theme.textBlack, 0.3), borderWidth: 1 },
            ]}>
            <Text style={[styles.label, { color: isPrimary ? theme.textLight : theme.textBlack }]}>
              {action.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
  },
  row: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 3.5,
  },
});
