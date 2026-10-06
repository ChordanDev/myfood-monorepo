import { StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { RecipeChatMessage } from '../domain/recipeChat';

interface RecipeChatMessageItemProps {
  message: RecipeChatMessage;
}

/** One turn of the conversation: the user speaks in a bubble, the assistant in plain text. */
export function RecipeChatMessageItem({ message }: RecipeChatMessageItemProps) {
  const { theme } = useRecipeTheme();
  const testID = `recipe-chat-message-${message.id}`;

  if (message.author === 'user') {
    return (
      <View testID={testID} style={[styles.userBubble, { backgroundColor: theme.colorLight }]}>
        <Text style={[styles.userText, { color: theme.textBlack }]}>{message.text}</Text>
      </View>
    );
  }

  return (
    <View testID={testID} style={styles.assistant}>
      <Text style={[styles.assistantText, { color: theme.textBlack }]}>{message.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  assistant: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    paddingHorizontal: 3.5,
  },
  assistantText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 26,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderRadius: 21,
    borderTopRightRadius: 7,
    maxWidth: '92%',
    paddingHorizontal: 17.5,
    paddingVertical: 14,
  },
  userText: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 26,
  },
});
