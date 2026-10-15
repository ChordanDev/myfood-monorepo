import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import { EAT_TODAY_LABEL, type EatTodayDestinationType } from '../domain/eatToday';

interface EatTodaySheetProps {
  visible: boolean;
  destinations: EatTodayDestinationType[];
  // Destinations whose meal is being cooked: shown, but they cannot be chosen.
  cookingDestinations?: EatTodayDestinationType[];
  onSelect: (mealType: EatTodayDestinationType) => void;
  onClose: () => void;
}

export function EatTodaySheet({
  visible,
  destinations,
  cookingDestinations = [],
  onSelect,
  onClose,
}: EatTodaySheetProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useRecipeTheme();
  const hasDestinations = destinations.length > 0;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        {/* Sibling of the backdrop pressable, so a press on the panel never closes the sheet. */}
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            { backgroundColor: theme.colorDark, paddingBottom: insets.bottom + 16 },
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.textLight }]}>
            {hasDestinations ? '¿Cuándo querés comerlo hoy?' : 'No hay horarios disponibles'}
          </Text>
          <Text style={[styles.body, { color: theme.textLight }]}>
            {hasDestinations
              ? 'Elegí el horario para intercambiar o mover esta comida a hoy.'
              : 'El mediodía y la cena ya pasaron o sus comidas ya fueron marcadas como cocinadas.'}
          </Text>

          <View style={styles.actions}>
            {destinations.map((mealType) => {
              const isCooking = cookingDestinations.includes(mealType);

              return (
                <Pressable
                  key={mealType}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isCooking }}
                  disabled={isCooking}
                  onPress={() => onSelect(mealType)}
                  style={({ pressed }) => [
                    styles.optionButton,
                    {
                      backgroundColor: theme.primaryAccent,
                      borderColor: theme.primaryAccentIntense,
                      opacity: isCooking ? 0.5 : pressed ? 0.9 : 1,
                    },
                  ]}>
                  <Text style={[styles.optionLabel, { color: theme.textBlack }]}>
                    {EAT_TODAY_LABEL[mealType]}
                  </Text>
                  {isCooking && (
                    <Text style={[styles.optionHint, { color: theme.textBlack }]}>
                      Se está cocinando. Terminá de cocinarla primero.
                    </Text>
                  )}
                </Pressable>
              );
            })}

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.textButtonLabel, { color: theme.textLight }]}>
                {hasDestinations ? 'Cancelar' : 'Entendido'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 24,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  body: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    opacity: 0.75,
    textAlign: 'center',
  },
  optionButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
    width: '100%',
  },
  optionHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  optionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
  },
  panel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 24,
    width: '100%',
  },
  textButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  textButtonLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  title: {
    fontFamily: 'MontserratAlternates_700Bold',
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
});
