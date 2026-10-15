import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { NoisyBackground, SafeAreaContent } from '@/components';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { useAnimatedThemeStyle } from '@/hooks/useAnimatedThemeStyle';
import { withOpacity } from '@/utils/colors';
import { LeftoverAddSheet, LeftoverRow } from '../components';
import { usePreparedLeftovers } from '../hooks/usePreparedLeftovers';

// The open Prepared leftovers, soonest consume-by date first, to eat or discard; loose ones
// (no Scheduled meal behind them) are added from here.
export function LeftoversScreen() {
  const { theme } = useRecipeTheme();
  const {
    leftovers,
    isLoading,
    isEmpty,
    errorMessage,
    busyId,
    consume,
    discard,
    add,
    startAdd,
    retry,
  } = usePreparedLeftovers();
  const [isAddSheetVisible, setIsAddSheetVisible] = useState(false);

  const groundStyle = useAnimatedThemeStyle({ backgroundColor: theme.appBg });
  const titleStyle = useAnimatedThemeStyle({ color: theme.textDark });
  const mutedStyle = useAnimatedThemeStyle({ color: withOpacity(theme.textBlack, 0.6) });

  return (
    <Animated.View style={[styles.screen, groundStyle]}>
      <NoisyBackground opacity={0.3} />
      <SafeAreaContent>
        <Animated.Text accessibilityRole="header" style={[styles.title, titleStyle]}>
          SOBRAS
        </Animated.Text>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              startAdd();
              setIsAddSheetVisible(true);
            }}
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: withOpacity(theme.textDark, 0.3), opacity: pressed ? 0.7 : 1 },
            ]}>
            <Animated.Text style={[styles.addLabel, titleStyle]}>Agregar sobra</Animated.Text>
          </Pressable>
          {errorMessage ? (
            <View style={styles.error}>
              <Animated.Text accessibilityRole="alert" style={[styles.message, titleStyle]}>
                {errorMessage}
              </Animated.Text>
              <Pressable accessibilityRole="button" onPress={retry}>
                <Animated.Text style={[styles.message, titleStyle]}>Reintentar</Animated.Text>
              </Pressable>
            </View>
          ) : null}
          {isLoading ? (
            <ActivityIndicator accessibilityLabel="Cargando las sobras" color={theme.textDark} />
          ) : null}
          {isEmpty ? (
            <Animated.Text style={[styles.message, mutedStyle]}>No tienes sobras</Animated.Text>
          ) : null}
          {leftovers.map((leftover) => (
            <LeftoverRow
              key={leftover.id}
              leftover={leftover}
              disabled={busyId !== null}
              onConsume={consume}
              onDiscard={discard}
            />
          ))}
        </ScrollView>
      </SafeAreaContent>
      <LeftoverAddSheet
        visible={isAddSheetVisible}
        onAdd={add}
        onClose={() => setIsAddSheetVisible(false)}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  addLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20 },
  error: { gap: 8 },
  list: { gap: 14, paddingHorizontal: 14, paddingBottom: 32 },
  message: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
  screen: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, paddingHorizontal: 14, paddingVertical: 12 },
});
