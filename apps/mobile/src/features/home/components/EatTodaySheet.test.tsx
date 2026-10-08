import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestInstance } from 'react-test-renderer';
import type { EatTodayDestinationType } from '../domain/eatToday';
import { EatTodaySheet } from './EatTodaySheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/context/RecipeThemeContext', () => ({
  useRecipeTheme: () => ({
    theme: {
      colorDark: '#111111',
      primaryAccent: '#ff6600',
      primaryAccentIntense: '#ff3300',
      textBlack: '#000000',
      textLight: '#eeeeee',
    },
  }),
}));

function renderSheet(destinations: EatTodayDestinationType[]) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  let tree: ReturnType<typeof create>;

  act(() => {
    tree = create(
      <EatTodaySheet visible destinations={destinations} onSelect={onSelect} onClose={onClose} />
    );
  });

  return { root: tree!.root, onSelect, onClose };
}

function getTexts(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => node.props.children as string);
}

function getButtons(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll(
    (node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
  );
}

function getButtonLabels(root: ReactTestInstance): string[] {
  return getButtons(root).flatMap((button) => getTexts(button));
}

function pressButton(root: ReactTestInstance, label: string) {
  const button = getButtons(root).find((candidate) => getTexts(candidate).includes(label));

  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }

  act(() => {
    button.props.onPress();
  });
}

describe('EatTodaySheet', () => {
  it('renders one button per destination followed by the cancel action', () => {
    const { root } = renderSheet(['lunch', 'dinner']);

    expect(getButtonLabels(root)).toEqual(['Mediodía', 'Cena', 'Cancelar']);
    expect(getTexts(root)).toEqual(
      expect.arrayContaining([
        '¿Cuándo querés comerlo hoy?',
        'Elegí el horario para intercambiar o mover esta comida a hoy.',
      ])
    );
  });

  it('only offers the destinations it receives', () => {
    const { root } = renderSheet(['dinner']);

    expect(getButtonLabels(root)).toEqual(['Cena', 'Cancelar']);
  });

  it('selects the meal type of the pressed destination', () => {
    const { root, onSelect, onClose } = renderSheet(['lunch', 'dinner']);

    pressButton(root, 'Cena');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('dinner');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from the cancel action without selecting', () => {
    const { root, onSelect, onClose } = renderSheet(['lunch', 'dinner']);

    pressButton(root, 'Cancelar');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes from the backdrop', () => {
    const { root, onClose } = renderSheet(['lunch']);

    const backdrop = getButtons(root).find(
      (candidate) => candidate.props.accessibilityLabel === 'Cerrar'
    );

    act(() => {
      backdrop!.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains that no slot is available when there are no destinations', () => {
    const { root, onSelect, onClose } = renderSheet([]);

    expect(getTexts(root)).toEqual(
      expect.arrayContaining([
        'No hay horarios disponibles',
        'El mediodía y la cena ya pasaron o sus comidas ya fueron marcadas como cocinadas.',
      ])
    );
    expect(getButtonLabels(root)).toEqual(['Entendido']);

    pressButton(root, 'Entendido');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
