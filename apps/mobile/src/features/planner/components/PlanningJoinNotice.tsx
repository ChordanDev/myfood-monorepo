import { StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';

interface PlanningJoinNoticeProps {
  /** Why the planning topic could not be joined, in the user's words. */
  message: string;
}

/** Inline notice under the Planner header. It does not block the screen. */
export function PlanningJoinNotice({ message }: PlanningJoinNoticeProps) {
  const { theme } = useRecipeTheme();

  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      testID="planner-join-notice"
      style={[styles.notice, { backgroundColor: theme.colorLight }]}>
      <CircleAlert color={theme.textDark} size={18} strokeWidth={2.5} />
      <Text selectable style={[styles.message, { color: theme.textDark }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  notice: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 17.5,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 10.5,
  },
});
