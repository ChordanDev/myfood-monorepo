import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { PlannerTypingIndicator } from '@/features/planner/components/PlannerTypingIndicator';
import { withOpacity } from '@/utils/colors';
import type { RecipeChatAction, RecipeChatMessage } from '../domain/recipeChat';
import { RecipeChatMessageItem } from './RecipeChatMessageItem';
import { RecipeQuickActions } from './RecipeQuickActions';

interface RecipeChatSectionProps {
  messages: RecipeChatMessage[];
  isThinking: boolean;
  onQuickAction: (messageId: string, actionId: RecipeChatAction['id']) => void;
}

/** The conversation with the cooking assistant, under the recipe cards in the same scroll. */
export function RecipeChatSection({ messages, isThinking, onQuickAction }: RecipeChatSectionProps) {
  const { theme } = useRecipeTheme();
  const hasConversation = messages.length > 0 || isThinking;

  return (
    <View testID="recipe-chat-section" style={styles.section}>
      <View style={styles.divider}>
        <Text
          accessibilityRole="header"
          style={[styles.dividerLabel, { color: withOpacity(theme.textBlack, 0.6) }]}>
          Asistente de cocina
        </Text>
        <View
          style={[styles.dividerLine, { backgroundColor: withOpacity(theme.colorDark, 0.3) }]}
        />
      </View>

      {hasConversation ? (
        <View style={styles.messages}>
          {messages.map((message) => (
            <Fragment key={message.id}>
              <RecipeChatMessageItem message={message} />
              {message.actions ? (
                <RecipeQuickActions
                  messageId={message.id}
                  actions={message.actions}
                  onSelect={onQuickAction}
                />
              ) : null}
            </Fragment>
          ))}
          {isThinking ? <PlannerTypingIndicator /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 3.5,
  },
  dividerLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  messages: {
    gap: 22,
  },
  section: {
    gap: 14,
    // On top of the gap between sections, as in the design.
    marginTop: 4,
  },
});
