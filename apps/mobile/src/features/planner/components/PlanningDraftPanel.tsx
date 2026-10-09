import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { describePlanningFailure, type PlanningDraft } from '../domain/planningDraft';
import { formatCostCents } from '../domain/proposalFormat';
import { ProposalDayCard } from './ProposalDayCard';

interface PlanningDraftPanelProps {
  draft: PlanningDraft;
  /** What the start button names, such as the range the User picked. */
  startLabel: string;
  /** False while the planning topic is not joined: starting would go nowhere. */
  canStart: boolean;
  onStart: () => void;
  onRetry: () => void;
}

/**
 * The first proposal in the conversation: the button that starts planning, the wait while it
 * generates, the day cards with the assistant's message once it is ready, or why it failed with a
 * way to try again.
 */
export function PlanningDraftPanel({
  draft,
  startLabel,
  canStart,
  onStart,
  onRetry,
}: PlanningDraftPanelProps) {
  const { theme } = useRecipeTheme();

  const action = (label: string, onPress: () => void, disabled: boolean, testID: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.button, { backgroundColor: theme.colorBlack, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.buttonLabel, { color: theme.primaryAccent }]}>{label}</Text>
    </Pressable>
  );

  if (draft.status === 'generating') {
    return (
      <View
        accessibilityLiveRegion="polite"
        testID="planner-progress"
        style={[styles.progress, { backgroundColor: theme.colorLight }]}>
        <ActivityIndicator color={theme.textDark} />
        <Text style={[styles.progressText, { color: theme.textDark }]}>Armando tu menú…</Text>
      </View>
    );
  }

  if (draft.status === 'ready') {
    const { proposal, message } = draft;
    return (
      <View testID="planner-proposal" style={styles.proposal}>
        {message === null ? null : (
          <Text style={[styles.message, { color: theme.textBlack }]}>{message.text}</Text>
        )}
        <Text testID="planner-proposal-cost" style={[styles.total, { color: theme.textDark }]}>
          {`Costo estimado: ${formatCostCents(proposal.estimatedCostCents)}`}
        </Text>
        {proposal.days.map((day) => (
          <ProposalDayCard key={day.date} day={day} />
        ))}
      </View>
    );
  }

  if (draft.status === 'failed') {
    return (
      <View style={styles.proposal}>
        <View
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          testID="planner-failure"
          style={[styles.progress, { backgroundColor: theme.colorLight }]}>
          <Text selectable style={[styles.progressText, { color: theme.textDark }]}>
            {describePlanningFailure(draft.failure)}
          </Text>
        </View>
        {action('Reintentar', onRetry, !canStart, 'planner-retry')}
      </View>
    );
  }

  return action(startLabel, onStart, !canStart, 'planner-start');
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: 21,
    paddingVertical: 12,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  message: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 26,
    paddingHorizontal: 3.5,
  },
  progress: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  progressText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  proposal: {
    gap: 14,
  },
  total: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 3.5,
  },
});
