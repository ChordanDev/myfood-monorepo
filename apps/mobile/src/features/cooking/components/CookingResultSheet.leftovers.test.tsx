import React from 'react';
import { Modal, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApiError } from '@/api/errors';
import { summarizeCookingFinish } from '../domain';
import { COOKING_FINISH_COVERED, COOKING_FINISH_NOTHING_CONSUMED } from '../fixtures';
import { CookingResultSheet } from './CookingResultSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      icon: '#cccccc',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000001',
      textLight: '#eeeeee',
      textMedium: '#bbbbbb',
    },
  }),
}));

// Rice in grams and oil in millilitres were deducted.
const SUMMARY = summarizeCookingFinish(COOKING_FINISH_COVERED);
const CHOICES = ['No sobró nada', 'Ingredientes', 'Comida preparada'];

type SheetProps = React.ComponentProps<typeof CookingResultSheet>;

// The sheet once the summary of a finish was closed: the prompt has taken its place.
function render(props: Partial<SheetProps> = {}) {
  const onAddIngredient = jest.fn(() => Promise.resolve());
  const onCreatePrepared = jest.fn(() => Promise.resolve());
  const onClose = jest.fn();
  const onCloseResult = jest.fn();
  const sheet = (overrides: Partial<SheetProps>) => (
    <CookingResultSheet
      summary={null}
      errorMessage={null}
      onClose={onCloseResult}
      leftoverPrompt={SUMMARY}
      onAddLeftoverIngredient={onAddIngredient}
      onCreatePreparedLeftover={onCreatePrepared}
      onCloseLeftoverPrompt={onClose}
      {...overrides}
    />
  );
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(sheet(props));
  });
  const { root } = tree!;
  const update = (overrides: Partial<SheetProps>) => act(() => tree.update(sheet(overrides)));
  const texts = () => root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
  const button = (testID: string) => root.findByProps({ testID, accessibilityRole: 'button' });
  const press = (testID: string) => act(() => button(testID).props.onPress());
  const pressAndSettle = (testID: string) =>
    act(async () => {
      button(testID).props.onPress();
    });
  const inputs = () => root.findAllByType(TextInput);
  const input = (label: string) => {
    const field = inputs().find((candidate) => candidate.props.accessibilityLabel === label);
    if (!field) throw new Error(`No input labelled "${label}"`);
    return field;
  };

  return {
    root,
    update,
    onCloseResult,
    texts,
    button,
    press,
    pressAndSettle,
    inputs,
    input,
    onAddIngredient,
    onCreatePrepared,
    onClose,
  };
}

describe('CookingResultSheet leftover prompt', () => {
  it('stays closed without a finish to ask about', () => {
    const { root, texts } = render({ leftoverPrompt: null });

    expect(root.findByType(Modal).props.visible).toBe(false);
    expect(texts()).toEqual([]);
  });

  it('takes the place of the summary in the same modal, which never closes in between', () => {
    const { root, update, texts } = render({ summary: SUMMARY, leftoverPrompt: null });
    expect(texts()).toContain('Esto se descontó de tu inventario');

    update({ summary: null, leftoverPrompt: SUMMARY });

    expect(root.findAllByType(Modal)).toHaveLength(1);
    expect(root.findByType(Modal).props.visible).toBe(true);
    expect(texts()).toContain('¿Sobró algo?');
    expect(texts()).not.toContain('Esto se descontó de tu inventario');
  });

  it('asks whether something was left, with the three choices', () => {
    const { root, texts } = render();

    expect(root.findByType(Modal).props.visible).toBe(true);
    expect(root.findByProps({ accessibilityRole: 'header' }).props.children).toBe('¿Sobró algo?');
    expect(texts().filter((text) => CHOICES.includes(text))).toEqual(CHOICES);
  });

  it('does not offer the ingredients when nothing was deducted', () => {
    const { texts } = render({
      leftoverPrompt: summarizeCookingFinish(COOKING_FINISH_NOTHING_CONSUMED),
    });

    expect(texts()).toEqual(expect.arrayContaining(['No sobró nada', 'Comida preparada']));
    expect(texts()).not.toContain('Ingredientes');
  });

  it('closes when nothing was left, from the choice, the backdrop and the back button', () => {
    const { root, press, onClose, onCloseResult, onAddIngredient, onCreatePrepared } = render();

    press('leftover-choice-none');
    act(() => root.findByProps({ accessibilityLabel: 'Cerrar' }).props.onPress());
    act(() => root.findByType(Modal).props.onRequestClose());

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onCloseResult).not.toHaveBeenCalled();
    expect(onAddIngredient).not.toHaveBeenCalled();
    expect(onCreatePrepared).not.toHaveBeenCalled();
  });

  it('lists the deducted ingredients with an empty quantity and their unit', () => {
    const { press, texts, inputs } = render();

    press('leftover-choice-ingredients');

    expect(texts()).toEqual(
      expect.arrayContaining([
        'Vuelven a tu inventario como sobra',
        'Arroz',
        'g',
        'Aceite de oliva',
        'ml',
        'Guardar',
        'Volver',
      ])
    );
    expect(texts()).not.toContain('No sobró nada');
    expect(inputs().map((field) => field.props.value)).toEqual(['', '']);
    expect(inputs().every((field) => field.props.keyboardType === 'decimal-pad')).toBe(true);
  });

  it('goes back from a step to the choices', () => {
    const { press, texts } = render();

    press('leftover-choice-ingredients');
    press('leftover-prompt-back');
    expect(texts().filter((text) => CHOICES.includes(text))).toEqual(CHOICES);

    press('leftover-choice-prepared');
    press('leftover-prompt-back');
    expect(texts().filter((text) => CHOICES.includes(text))).toEqual(CHOICES);
  });

  it('saves the quantity typed for an ingredient and closes', async () => {
    const { press, pressAndSettle, button, input, onAddIngredient, onClose } = render();
    press('leftover-choice-ingredients');
    expect(button('leftover-prompt-save').props.disabled).toBe(true);

    act(() => input('Arroz').props.onChangeText('50'));
    expect(button('leftover-prompt-save').props.disabled).toBe(false);
    await pressAndSettle('leftover-prompt-save');

    expect(onAddIngredient).toHaveBeenCalledTimes(1);
    expect(onAddIngredient).toHaveBeenCalledWith({
      ingredientId: SUMMARY.consumed[0].ingredientId,
      quantityMilli: 50_000,
      unit: 'g',
      isLeftover: true,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('proposes the recipe and one portion for the prepared food, and saves them', async () => {
    const { press, pressAndSettle, input, onCreatePrepared, onClose } = render();

    press('leftover-choice-prepared');

    expect(input('Título').props.value).toBe('Arroz con aceite');
    expect(input('Porciones').props.value).toBe('1');
    expect(input('Porciones').props.keyboardType).toBe('number-pad');

    await pressAndSettle('leftover-prompt-save');

    expect(onCreatePrepared).toHaveBeenCalledWith({
      title: 'Arroz con aceite',
      portions: 1,
      scheduledMealId: SUMMARY.scheduledMealId,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot save the prepared food without a title', () => {
    const { press, button, input } = render();
    press('leftover-choice-prepared');

    act(() => input('Título').props.onChangeText('  '));

    expect(button('leftover-prompt-save').props.disabled).toBe(true);
  });

  it('locks the quantities while they are being saved, and unlocks them if the save fails', async () => {
    let failSave: (error: Error) => void = () => undefined;
    const onAddIngredient = jest.fn(
      () => new Promise<void>((_resolve, reject) => (failSave = reject))
    );
    const { press, pressAndSettle, input, inputs } = render({
      onAddLeftoverIngredient: onAddIngredient,
    });
    press('leftover-choice-ingredients');
    act(() => input('Arroz').props.onChangeText('50'));

    await pressAndSettle('leftover-prompt-save');

    // What is typed now would not be part of the save already on its way.
    expect(inputs().map((field) => field.props.editable)).toEqual(inputs().map(() => false));

    await act(async () => failSave(new ApiError('validation_error', 'no', 422)));

    expect(inputs().map((field) => field.props.editable)).toEqual(inputs().map(() => true));
  });

  it('locks the title and the portions while the prepared food is being saved', async () => {
    const onCreatePrepared = jest.fn(() => new Promise<void>(() => undefined));
    const { press, pressAndSettle, input } = render({ onCreatePreparedLeftover: onCreatePrepared });
    press('leftover-choice-prepared');
    expect(input('Título').props.editable).toBe(true);

    await pressAndSettle('leftover-prompt-save');

    expect(input('Título').props.editable).toBe(false);
    expect(input('Porciones').props.editable).toBe(false);
  });

  it('stays open and shows why when a save fails', async () => {
    const onCreatePrepared = jest.fn(() =>
      Promise.reject(new ApiError('validation_error', 'no', 422))
    );
    const { root, press, pressAndSettle, onClose } = render({
      onCreatePreparedLeftover: onCreatePrepared,
    });
    press('leftover-choice-prepared');

    await pressAndSettle('leftover-prompt-save');

    expect(root.findByProps({ accessibilityRole: 'alert' }).props.children).toBe(
      'Los datos ingresados no son válidos.'
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
