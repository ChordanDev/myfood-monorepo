import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useRecipeTheme } from '@/context/RecipeThemeContext';
import type { UnitType } from '@/types/domain';
import { withOpacity } from '@/utils/colors';
import { UNIT_LABEL } from '@/utils/formatQuantity';
import { parseExpiryInput, parseQuantityInputMilli } from '../domain';
import { INGREDIENT_QUERY_MAX_LENGTH, useIngredientSearch, type IngredientSearch } from '../hooks';
import type { AddExtraItemPayload, IngredientOption } from '../types';
import {
  InventorySheet,
  InventorySheetField,
  InventorySheetForm,
  useInventorySheetWrite,
} from './InventorySheet';

// The bound the API applies to a note, so a note is never rejected for its length.
const NOTES_MAX_LENGTH = 1000;

interface InventoryAddSheetProps {
  visible: boolean;
  onAdd: (payload: AddExtraItemPayload) => Promise<unknown>;
  onClose: () => void;
}

const UNIT_OPTIONS: { unit: UnitType; name: string }[] = [
  { unit: 'g', name: 'Gramos' },
  { unit: 'ml', name: 'Mililitros' },
  { unit: 'unit', name: 'Unidades' },
];

const CHECK_ICON_SIZE = 14;

// For something that came from outside the app: it is added as an extra lot.
export function InventoryAddSheet({ visible, onAdd, onClose }: InventoryAddSheetProps) {
  const { opening, pending, errorMessage, run, close } = useInventorySheetWrite(visible, onClose);

  return (
    <InventorySheet visible={visible} onClose={close}>
      <InventoryAddForm
        key={opening}
        pending={pending}
        errorMessage={errorMessage}
        onAdd={(payload) => run('submit', () => onAdd(payload))}
        onClose={close}
      />
    </InventorySheet>
  );
}

interface InventoryAddFormProps {
  pending: 'submit' | 'secondary' | null;
  errorMessage: string | null;
  onAdd: (payload: AddExtraItemPayload) => void;
  onClose: () => void;
}

function InventoryAddForm({ pending, errorMessage, onAdd, onClose }: InventoryAddFormProps) {
  const { theme } = useRecipeTheme();
  const [name, setName] = useState('');
  // The Ingredient of the catalogue the name was chosen from. Typing the name again forgets it.
  const [chosen, setChosen] = useState<IngredientOption | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [unit, setUnit] = useState<UnitType>('g');
  const [expiryText, setExpiryText] = useState('');
  const [notes, setNotes] = useState('');
  const [isLeftover, setIsLeftover] = useState(false);

  // Once an Ingredient is chosen its name is in the field: there is nothing left to search.
  const search = useIngredientSearch(chosen ? '' : name);
  // The user types display units; the API takes thousandths, above zero for an add.
  const quantityMilli = parseQuantityInputMilli(quantityText);
  const expiresAt = parseExpiryInput(expiryText);
  // `maxLength` only limits typing: the bound is applied again to what is sent.
  const trimmedNotes = notes.slice(0, NOTES_MAX_LENGTH).trim();
  const hasQuantity = quantityMilli !== null && quantityMilli > 0;
  const canAdd = chosen !== null && hasQuantity && expiresAt !== null;

  const handleNameChange = (text: string) => {
    setName(text);
    setChosen(null);
  };

  const choose = (ingredient: IngredientOption) => {
    setChosen(ingredient);
    setName(ingredient.name);
  };

  const handleAdd = () => {
    if (chosen === null || !hasQuantity || expiresAt === null) return;

    // What was left blank is left out, so the API infers the expiry and merges a plain add
    // into the lot it already has.
    onAdd({
      ingredientId: chosen.id,
      quantityMilli,
      unit,
      ...(expiresAt !== undefined && { expiresAt }),
      ...(trimmedNotes.length > 0 && { notes: trimmedNotes }),
      ...(isLeftover && { isLeftover }),
    });
  };

  const optionBorderColor = withOpacity(theme.icon, 0.3);

  return (
    <InventorySheetForm
      title="Agregar producto"
      pending={pending}
      errorMessage={errorMessage}
      canSubmit={canAdd}
      submit={{ label: 'Agregar', pendingLabel: 'Agregando…', onPress: handleAdd }}
      onClose={onClose}>
      <InventorySheetField
        label="Nombre"
        value={name}
        onChangeText={handleNameChange}
        maxLength={INGREDIENT_QUERY_MAX_LENGTH}
        autoCapitalize="sentences"
        autoCorrect={false}
        placeholder="Buscá un ingrediente, ej.: Leche"
      />

      {chosen === null ? <IngredientResults search={search} onChoose={choose} /> : null}

      <InventorySheetField
        label="Cantidad"
        value={quantityText}
        onChangeText={setQuantityText}
        keyboardType="decimal-pad"
        trailing={UNIT_LABEL[unit]}
      />

      <View accessibilityLabel="Unidad" accessibilityRole="radiogroup" style={styles.units}>
        {UNIT_OPTIONS.map((option) => {
          const isChosen = option.unit === unit;

          return (
            <Pressable
              key={option.unit}
              accessibilityLabel={option.name}
              accessibilityRole="radio"
              accessibilityState={{ checked: isChosen }}
              onPress={() => setUnit(option.unit)}
              style={({ pressed }) => [
                styles.unit,
                {
                  backgroundColor: isChosen ? theme.primaryAccent : withOpacity(theme.icon, 0.15),
                  borderColor: isChosen ? theme.primaryAccentIntense : optionBorderColor,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}>
              <Text
                style={[styles.unitLabel, { color: isChosen ? theme.textBlack : theme.textLight }]}>
                {UNIT_LABEL[option.unit]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <InventorySheetField
        label="Vence"
        value={expiryText}
        onChangeText={setExpiryText}
        keyboardType="numbers-and-punctuation"
        placeholder="DD/MM/AAAA (opcional)"
      />

      <InventorySheetField
        label="Notas"
        value={notes}
        onChangeText={setNotes}
        maxLength={NOTES_MAX_LENGTH}
        placeholder="Opcional"
      />

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isLeftover }}
        onPress={() => setIsLeftover((current) => !current)}
        hitSlop={8}
        style={({ pressed }) => [styles.leftover, { opacity: pressed ? 0.7 : 1 }]}>
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: isLeftover ? theme.primaryAccent : withOpacity(theme.icon, 0.15),
              borderColor: isLeftover ? theme.primaryAccentIntense : optionBorderColor,
            },
          ]}>
          {isLeftover ? (
            <Check size={CHECK_ICON_SIZE} color={theme.textBlack} strokeWidth={3} />
          ) : null}
        </View>
        <Text style={[styles.leftoverLabel, { color: theme.textLight }]}>Es una sobra</Text>
      </Pressable>
    </InventorySheetForm>
  );
}

interface IngredientResultsProps {
  search: IngredientSearch;
  onChoose: (ingredient: IngredientOption) => void;
}

// What the catalogue answered for the name typed so far, to choose the Ingredient from.
function IngredientResults({ search, onChoose }: IngredientResultsProps) {
  const { theme } = useRecipeTheme();
  const statusText = {
    idle: null,
    searching: 'Buscando…',
    error: 'No pudimos buscar ingredientes. Probá de nuevo.',
    done: search.results.length === 0 ? 'No encontramos ese ingrediente.' : null,
  }[search.status];

  if (statusText) {
    return <Text style={[styles.searchStatus, { color: theme.textMedium }]}>{statusText}</Text>;
  }

  if (search.results.length === 0) return null;

  return (
    <View accessibilityLabel="Ingredientes encontrados" style={styles.options}>
      {search.results.map((ingredient) => (
        <Pressable
          key={ingredient.id}
          accessibilityLabel={ingredient.name}
          accessibilityHint="Elegí este ingrediente"
          accessibilityRole="button"
          onPress={() => onChoose(ingredient)}
          style={({ pressed }) => [
            styles.option,
            {
              backgroundColor: withOpacity(theme.icon, 0.15),
              borderColor: withOpacity(theme.icon, 0.3),
              opacity: pressed ? 0.8 : 1,
            },
          ]}>
          <Text style={[styles.optionLabel, { color: theme.textLight }]}>{ingredient.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  leftover: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 32,
  },
  leftoverLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  option: {
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  optionLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 20,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  searchStatus: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 18,
  },
  unit: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  unitLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
  units: {
    flexDirection: 'row',
    gap: 8,
  },
});
