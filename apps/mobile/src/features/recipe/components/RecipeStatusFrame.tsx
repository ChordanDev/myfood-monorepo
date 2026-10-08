import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { RECIPE_SCREEN_SIDE_PADDING } from '../constants';
import { RecipeHeaderButton } from './RecipeHeaderButton';
import { RecipeTopGradient } from './RecipeTopGradient';

interface RecipeStatusFrameProps {
  /** Distance of the back button from the top of the screen. */
  top: number;
  onBack: () => void;
  children: ReactNode;
}

/** What the screen draws while it has no recipe: its ground, the way back and one status. */
export function RecipeStatusFrame({ top, onBack, children }: RecipeStatusFrameProps) {
  const { theme } = useRecipeTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.appBg }]}>
      <RecipeTopGradient />
      {children}
      <View style={[styles.back, { top }]}>
        <RecipeHeaderButton
          testID="recipe-header-back"
          accessibilityLabel="Volver"
          onPress={onBack}>
          <ArrowLeft size={24} color={theme.primaryAccent} strokeWidth={2.5} />
        </RecipeHeaderButton>
      </View>
    </View>
  );
}

export function RecipeStatusMessage({ testID, children }: { testID: string; children: string }) {
  const { theme } = useRecipeTheme();

  return (
    <Text testID={testID} style={[styles.message, { color: theme.textDark }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  back: {
    left: RECIPE_SCREEN_SIDE_PADDING,
    position: 'absolute',
  },
  message: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  screen: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center',
  },
});
