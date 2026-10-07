import { Pressable, StyleSheet } from 'react-native';
import { Mic } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShadowSurface } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { CUSTOM_TAB_BAR_CONTENT_HEIGHT } from '@/features/planner/constants';
import {
  INVENTORY_HORIZONTAL_PADDING,
  INVENTORY_VOICE_BUTTON_GAP,
  INVENTORY_VOICE_BUTTON_SIZE,
} from '../constants/layout';

interface InventoryVoiceButtonProps {
  onPress?: () => void;
}

export function InventoryVoiceButton({ onPress }: InventoryVoiceButtonProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();

  return (
    <ShadowSurface
      style={[
        styles.container,
        { bottom: insets.bottom + CUSTOM_TAB_BAR_CONTENT_HEIGHT + INVENTORY_VOICE_BUTTON_GAP },
      ]}>
      <Pressable
        accessibilityLabel="Agregar o editar por voz"
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.colorDark, transform: [{ scale: pressed ? 0.95 : 1 }] },
        ]}>
        <Mic size={24} color={theme.appBg} strokeWidth={2.5} />
      </Pressable>
    </ShadowSurface>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: INVENTORY_VOICE_BUTTON_SIZE / 2,
    height: INVENTORY_VOICE_BUTTON_SIZE,
    justifyContent: 'center',
    width: INVENTORY_VOICE_BUTTON_SIZE,
  },
  container: {
    borderRadius: INVENTORY_VOICE_BUTTON_SIZE / 2,
    position: 'absolute',
    right: INVENTORY_HORIZONTAL_PADDING,
  },
});
