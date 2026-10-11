import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopFadeMask } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CHAT_COMPOSER_MIN_HEIGHT, ChatComposer } from '@/features/assistant-chat';
import {
  RecipeBottomFade,
  RecipeChatSection,
  RecipeCookedConfirmSheet,
  RecipeForbidden,
  RecipeHeader,
  RecipeIngredientsCard,
  RecipeLoadError,
  RecipeLoading,
  RecipeNotFound,
  RecipePreparationCard,
  RecipeTopGradient,
} from '../components';
import {
  RECIPE_BOTTOM_FADE_REACH,
  RECIPE_COMPOSER_BOTTOM_GAP,
  RECIPE_CONTENT_TOP_PADDING,
  RECIPE_HEADER_FADE_SIZE,
  RECIPE_HEADER_HEIGHT,
  RECIPE_HEADER_MIN_TOP,
  RECIPE_SCREEN_SIDE_PADDING,
  RECIPE_SECTION_GAP,
} from '../constants';
import { recipeChatPlaceholder } from '../domain/recipeChat';
import { buildRecipeFacts } from '../domain/recipeFormat';
import { useActivateRecipePalette } from '../hooks/useActivateRecipePalette';
import { useRecipeChat } from '../hooks/useRecipeChat';
import { CookingResultSheet } from '@/features/cooking';
import { useRecipeScreen } from '../hooks/useRecipeScreen';
import { useScrollToEndOnAppend } from '../hooks/useScrollToEndOnAppend';

export function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    recipe,
    status,
    rows,
    isFavorite,
    canMarkAsCooked,
    isChatEnabled,
    chatScheduledMealId,
    isMealCooked,
    isCookedConfirmVisible,
    cookingSummary,
    cookingErrorMessage,
    handleBack,
    handleRetry,
    handleToggleFavorite,
    handleRequestMarkAsCooked,
    handleConfirmCooked,
    handleCancelCooked,
    handleCloseCookingResult,
  } = useRecipeScreen();
  const chat = useRecipeChat({
    scheduledMealId: chatScheduledMealId,
    isEnabled: isChatEnabled,
    isCooked: isMealCooked,
  });
  const [composerHeight, setComposerHeight] = useState(CHAT_COMPOSER_MIN_HEIGHT);
  // How far the keyboard lifts the composer, as the composer itself computes it; zero at rest.
  const [keyboardLift, setKeyboardLift] = useState(0);
  const { scrollViewRef, handleContentSizeChange } = useScrollToEndOnAppend(
    chat.messages.length,
    chat.isThinking,
    keyboardLift
  );

  useActivateRecipePalette(recipe?.theme);

  const headerTop = Math.max(insets.top, RECIPE_HEADER_MIN_TOP);
  // From the bottom edge of the screen up to where the fade over the composer ends. The scroll
  // content is padded by the same amount, so its last line rests just above the fade.
  const bottomOverlayHeight =
    insets.bottom + RECIPE_COMPOSER_BOTTOM_GAP + composerHeight + RECIPE_BOTTOM_FADE_REACH;

  if (status === 'loading') return <RecipeLoading top={headerTop} onBack={handleBack} />;
  if (status === 'failed') {
    return <RecipeLoadError top={headerTop} onBack={handleBack} onRetry={handleRetry} />;
  }
  if (status === 'forbidden') return <RecipeForbidden top={headerTop} onBack={handleBack} />;
  if (!recipe) return <RecipeNotFound top={headerTop} onBack={handleBack} />;

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <RecipeTopGradient />

      {/* A mask, not a painted gradient: the ground behind is a gradient under noise, which an
          overlay could not match. The mask is clear at the bottom edge of the header and solid
          from where the fade ends, so the resting content is untouched. */}
      <TopFadeMask
        fadeSize={RECIPE_HEADER_FADE_SIZE}
        style={{ marginTop: headerTop + RECIPE_HEADER_HEIGHT }}>
        <ScrollView
          ref={scrollViewRef}
          testID="recipe-scroll"
          style={styles.scroll}
          // The composer and its fade rise by the keyboard lift, and so does the room under the
          // conversation: its last line always rests just above the fade.
          contentContainerStyle={[
            styles.content,
            { paddingBottom: bottomOverlayHeight + keyboardLift },
          ]}
          // The paddings already include the safe area; iOS must not add it a second time.
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={handleContentSizeChange}>
          {/* Without a request handler the rows only read: a missing one cannot be added. */}
          <RecipeIngredientsCard rows={rows} facts={buildRecipeFacts(recipe)} />
          <RecipePreparationCard steps={recipe.steps} />
          <RecipeChatSection
            messages={chat.messages}
            isThinking={chat.isThinking}
            errorMessage={chat.errorMessage}
          />
        </ScrollView>
      </TopFadeMask>

      {/* The composer lifts itself over the keyboard, as it does on the planner. The fade is its
          backdrop, so it rises in the same view and the composer never leaves the ground color. */}
      <ChatComposer
        value={chat.input}
        isThinking={chat.isThinking}
        onChangeText={chat.setInput}
        onHeightChange={setComposerHeight}
        onKeyboardLiftChange={setKeyboardLift}
        onSubmit={chat.sendMessage}
        placeholder={recipeChatPlaceholder(chat.availability)}
        disabled={chat.availability !== 'available'}
        restingBottomGap={RECIPE_COMPOSER_BOTTOM_GAP}
        testIDPrefix="recipe-composer"
        backdrop={<RecipeBottomFade height={bottomOverlayHeight} />}
      />

      <RecipeHeader
        top={headerTop}
        title={recipe.name}
        isFavorite={isFavorite}
        canMarkAsCooked={canMarkAsCooked}
        onBack={handleBack}
        onToggleFavorite={handleToggleFavorite}
        onMarkAsCooked={handleRequestMarkAsCooked}
      />

      <RecipeCookedConfirmSheet
        visible={isCookedConfirmVisible}
        onConfirm={handleConfirmCooked}
        onCancel={handleCancelCooked}
      />

      <CookingResultSheet
        summary={cookingSummary}
        errorMessage={cookingErrorMessage}
        onClose={handleCloseCookingResult}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: RECIPE_SECTION_GAP,
    paddingHorizontal: RECIPE_SCREEN_SIDE_PADDING,
    // The content starts under the fade and rests just below it.
    paddingTop: RECIPE_HEADER_FADE_SIZE + RECIPE_CONTENT_TOP_PADDING,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
});
