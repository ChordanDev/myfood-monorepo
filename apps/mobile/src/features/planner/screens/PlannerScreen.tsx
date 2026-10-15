import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuthErrorMessage } from '@/api/errors';
import { NoisyBackground } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import {
  CHAT_COMPOSER_CLEARANCE,
  CHAT_COMPOSER_MIN_HEIGHT,
  ChatComposer,
} from '@/features/assistant-chat';
import {
  PlannerHeader,
  PlanningDraftPanel,
  PlanningFavoritesPicker,
  PlanningJoinNotice,
} from '../components';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '../constants';
import { formatPlanningStartLabel } from '../domain/planningRange';
import { usePlanningDraft } from '../hooks/usePlanningDraft';
import { usePlanningFavorites } from '../hooks/usePlanningFavorites';
import { usePlanningLease } from '../hooks/usePlanningLease';
import { usePlanningRange } from '../hooks/usePlanningRange';
import { usePlanningTopic } from '../hooks/usePlanningTopic';

// Shown after a confirm that got no answer: the menu may be saved already, and a new confirm
// answers the result of the first one.
const CONFIRM_UNRESOLVED_MESSAGE =
  'No sabemos si tu menú se guardó. Tocá Confirmar menú de nuevo para comprobarlo.';

// Shown on `session_expired` and `session_lost_lock` alike: the user only needs to know that the
// conversation cannot continue and a new one is needed.
const SESSION_OVER_MESSAGE = 'Esta sesión de planificación terminó. Empezá una nueva para seguir.';

export const PlannerScreen = () => {
  const { theme } = useRecipeTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const planningTopic = usePlanningTopic();
  const planningRange = usePlanningRange();
  const planningDraft = usePlanningDraft(planningTopic);
  const { draft, start: startPlanning, retry: retryPlanning } = planningDraft;
  // The session of the draft is kept alive while it generates and while its proposal waits for
  // the User.
  const planningLease = usePlanningLease(
    draft.status === 'generating' || draft.status === 'ready' ? draft.sessionId : null
  );
  const planningFavorites = usePlanningFavorites();
  const scrollViewRef = useRef<ScrollView>(null);
  const [input, setInput] = useState('');
  const [composerHeight, setComposerHeight] = useState(CHAT_COMPOSER_MIN_HEIGHT);

  // Chat refinement is deferred (#26), so the composer has a single job: its text is the request
  // of a new plan. It sends exactly when the start button is offered, so never while a plan runs.
  const canStart = planningTopic.status === 'joined';
  const canSendRequest = canStart && draft.status === 'idle';

  const contentBottomClearance =
    composerHeight + insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE + 28;

  // What is typed in the composer is the free-text request of the plan, sent with the start. It
  // is dropped once the server accepts the start, so a refused one leaves it to be fixed, unless
  // the User has typed something else in the meantime.
  const handleStartPlanning = useCallback(() => {
    const sent = input;
    startPlanning(planningRange.range, sent, planningFavorites.selectedRecipeIds, () =>
      setInput((current) => (current === sent ? '' : current))
    );
  }, [input, planningFavorites.selectedRecipeIds, planningRange.range, startPlanning]);

  const handleSubmitRequest = useCallback(() => {
    if (canSendRequest) handleStartPlanning();
  }, [canSendRequest, handleStartPlanning]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: !reduceMotion });
    });
    return () => cancelAnimationFrame(frame);
    // Only on open: later changes of the reduced-motion setting do not scroll again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <NoisyBackground opacity={0.3} />

      <PlannerHeader planningRange={planningRange} />

      {planningTopic.status === 'refused' ? (
        <PlanningJoinNotice message={getAuthErrorMessage(planningTopic.error)} />
      ) : null}

      {(planningTopic.status === 'joined' && planningTopic.sessionOver) ||
      planningLease.isLeaseLost ? (
        <PlanningJoinNotice message={SESSION_OVER_MESSAGE} />
      ) : null}

      <ScrollView
        ref={scrollViewRef}
        testID="planner-conversation-list"
        style={{ marginTop: 21, flex: 1, paddingHorizontal: 17.5 }}
        contentContainerStyle={{
          paddingBottom: contentBottomClearance,
          gap: 28,
        }}
        // The bottom clearance already includes the safe area. Letting iOS add it again makes the
        // list scroll that much past its end.
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {draft.status === 'idle' ? (
          <PlanningFavoritesPicker
            favorites={planningFavorites.favorites}
            selectedRecipeIds={planningFavorites.selectedRecipeIds}
            onToggle={planningFavorites.toggle}
          />
        ) : null}
        <PlanningDraftPanel
          draft={draft}
          startLabel={formatPlanningStartLabel(planningRange.range)}
          canStart={canStart}
          onStart={handleStartPlanning}
          onRetry={retryPlanning}
          onConfirm={planningDraft.confirm}
          onReject={planningDraft.reject}
          onCancel={planningDraft.cancel}
          pendingAction={planningDraft.pendingAction}
          actionErrorMessage={
            planningDraft.actionError === null
              ? undefined
              : planningDraft.isConfirmUnresolved
                ? CONFIRM_UNRESOLVED_MESSAGE
                : getAuthErrorMessage(planningDraft.actionError)
          }
          isConfirmUnresolved={planningDraft.isConfirmUnresolved}
        />
      </ScrollView>

      <ChatComposer
        value={input}
        isThinking={false}
        disabled={!canSendRequest}
        onChangeText={setInput}
        onHeightChange={setComposerHeight}
        onSubmit={handleSubmitRequest}
        restingBottomGap={CUSTOM_TAB_BAR_CONTENT_HEIGHT + CHAT_COMPOSER_CLEARANCE}
        testIDPrefix="planner-composer"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
