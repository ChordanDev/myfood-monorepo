import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopFadeMask } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CHAT_COMPOSER_MIN_HEIGHT, ChatComposer } from '@/features/assistant-chat';
import {
  RecipeBottomFade,
  RecipeChatSection,
  RecipeHeader,
  RecipeIngredientsCard,
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
import { RECIPE_CHAT_DISABLED_PLACEHOLDER, RECIPE_CHAT_PLACEHOLDER } from '../domain/recipeChat';
import { useActivateRecipePalette } from '../hooks/useActivateRecipePalette';
import { useRecipeChat } from '../hooks/useRecipeChat';
import { useRecipeScreen } from '../hooks/useRecipeScreen';
import { useScrollToEndOnAppend } from '../hooks/useScrollToEndOnAppend';

export function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const {
    recipe,
    rows,
    isFavorite,
    canMarkAsCooked,
    isChatEnabled,
    handleBack,
    handleToggleFavorite,
    handleMarkAsCooked,
    handleRequestIngredient,
    handleAddOffer,
  } = useRecipeScreen();
  const chat = useRecipeChat({
    recipeName: recipe?.name ?? '',
    rows,
    isEnabled: isChatEnabled,
    onAddOffer: handleAddOffer,
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
          <RecipeIngredientsCard rows={rows} onRequestIngredient={handleRequestIngredient} />
          <RecipePreparationCard steps={recipe.steps} />
          <RecipeChatSection
            messages={chat.messages}
            isThinking={chat.isThinking}
            onQuickAction={chat.answerQuickAction}
          />
        </ScrollView>
      </TopFadeMask>

      <RecipeBottomFade height={bottomOverlayHeight} />

      {/* The composer lifts itself over the keyboard, as it does on the planner. */}
      <ChatComposer
        value={chat.input}
        isThinking={chat.isThinking}
        onChangeText={chat.setInput}
        onHeightChange={setComposerHeight}
        onKeyboardLiftChange={setKeyboardLift}
        onSubmit={chat.sendMessage}
        placeholder={isChatEnabled ? RECIPE_CHAT_PLACEHOLDER : RECIPE_CHAT_DISABLED_PLACEHOLDER}
        disabled={!isChatEnabled}
        restingBottomGap={RECIPE_COMPOSER_BOTTOM_GAP}
        testIDPrefix="recipe-composer"
      />

      <RecipeHeader
        top={headerTop}
        title={recipe.name}
        isFavorite={isFavorite}
        canMarkAsCooked={canMarkAsCooked}
        onBack={handleBack}
        onToggleFavorite={handleToggleFavorite}
        onMarkAsCooked={handleMarkAsCooked}
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
